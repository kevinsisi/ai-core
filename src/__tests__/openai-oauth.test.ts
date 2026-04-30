import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenAIOAuthError,
  refreshOpenAIToken,
  startOpenAIAuth,
} from "../provider/auth/openai.js";
import { isOAuthCredentialExpired } from "../provider/auth/types.js";
import type { OAuthCredential } from "../provider/auth/types.js";

const ORIGINAL_FETCH = globalThis.fetch;

describe("startOpenAIAuth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("builds authorize URL with PKCE and state, exchanges code, returns OAuthCredential", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "tok-123",
          refresh_token: "ref-456",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    let capturedAuthorizeURL = "";
    const port = pickPort();

    const flow = startOpenAIAuth({
      port,
      manualOpen: true,
      label: "test-account",
      onAuthorizeURL: (url) => {
        capturedAuthorizeURL = url;
      },
    });

    await waitForListening(port);
    const parsed = new URL(capturedAuthorizeURL);
    expect(parsed.origin).toBe("https://auth.openai.com");
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("scope")).toBe(
      "openid profile email offline_access"
    );
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      `http://localhost:${port}/auth/callback`
    );
    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();

    const callbackStatus = await loopbackGet(
      port,
      `/auth/callback?code=auth-code-xyz&state=${encodeURIComponent(state!)}`
    );
    expect(callbackStatus).toBe(200);

    const credential = await flow;
    expect(credential).toMatchObject({
      type: "oauth",
      provider: "openai",
      accessToken: "tok-123",
      refreshToken: "ref-456",
      credentialLabel: "test-account",
    });
    expect(credential.expiresAt).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [tokenURL, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenURL).toBe("https://auth.openai.com/oauth/token");
    expect(tokenInit?.method).toBe("POST");
    const body = JSON.parse(String(tokenInit?.body));
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth-code-xyz");
    expect(body.client_id).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    expect(typeof body.code_verifier).toBe("string");
    expect(body.code_verifier.length).toBe(43);
  });

  it("rejects when callback state mismatches", async () => {
    const port = pickPort();
    const flow = startOpenAIAuth({ port, manualOpen: true });
    flow.catch(() => {});
    await waitForListening(port);

    await loopbackGet(port, "/auth/callback?code=x&state=wrong");
    await expect(flow).rejects.toBeInstanceOf(OpenAIOAuthError);
  });

  it("rejects when authorize endpoint returns error", async () => {
    const port = pickPort();
    const flow = startOpenAIAuth({ port, manualOpen: true });
    flow.catch(() => {});
    await waitForListening(port);

    await loopbackGet(
      port,
      "/auth/callback?error=access_denied&error_description=User+declined"
    );
    await expect(flow).rejects.toThrow(/access_denied/);
  });
});

describe("refreshOpenAIToken", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("posts refresh_token grant and returns refreshed credential", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "new-tok", expires_in: 1800 }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const credential = await refreshOpenAIToken("old-refresh");
    expect(credential).toMatchObject({
      type: "oauth",
      provider: "openai",
      accessToken: "new-tok",
      refreshToken: "old-refresh",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
    });
  });

  it("throws OpenAIOAuthError on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    await expect(refreshOpenAIToken("bad")).rejects.toBeInstanceOf(OpenAIOAuthError);
  });
});

describe("isOAuthCredentialExpired", () => {
  function makeCred(expiresAt: string | undefined): OAuthCredential {
    return {
      type: "oauth",
      provider: "openai",
      accessToken: "tok",
      ...(expiresAt && { expiresAt }),
    };
  }

  it("returns false when expiresAt is missing (caller should fall back to 401)", () => {
    expect(isOAuthCredentialExpired(makeCred(undefined))).toBe(false);
  });

  it("returns false for an unparseable expiresAt", () => {
    expect(isOAuthCredentialExpired(makeCred("not a date"))).toBe(false);
  });

  it("returns true when expiry has already passed", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isOAuthCredentialExpired(makeCred(past))).toBe(true);
  });

  it("returns true within the leeway window (treats near-expiry as expired)", () => {
    // Default leeway is 60s — a token expiring 30s from now should look expired.
    const soon = new Date(Date.now() + 30_000).toISOString();
    expect(isOAuthCredentialExpired(makeCred(soon))).toBe(true);
  });

  it("returns false when expiry is comfortably in the future", () => {
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(isOAuthCredentialExpired(makeCred(later))).toBe(false);
  });

  it("respects a custom leeway (0ms = treat exactly-at-expiry as expired)", () => {
    const inFiveSeconds = new Date(Date.now() + 5_000).toISOString();
    expect(isOAuthCredentialExpired(makeCred(inFiveSeconds), 0)).toBe(false);
    expect(isOAuthCredentialExpired(makeCred(inFiveSeconds), 10_000)).toBe(true);
  });
});

let nextPort = 18000 + Math.floor(Math.random() * 1000);
function pickPort(): number {
  nextPort += 1;
  return nextPort;
}

function loopbackGet(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET" },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForListening(port: number, attempts = 50): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const status = await loopbackGet(port, "/_probe");
      if (typeof status === "number") return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Loopback server on port ${port} never came up`);
}
