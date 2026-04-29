import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as http from "node:http";
import { ProviderID } from "../schema.js";
import type { OAuthCredential } from "./types.js";

/**
 * OpenAI ChatGPT OAuth (PKCE) — uses the Codex CLI public client so a user
 * with a paid ChatGPT/Codex subscription can authenticate without provisioning
 * a separate API key.
 *
 * Endpoints, scopes, and the loopback callback port match the Codex CLI flow
 * documented at https://developers.openai.com/codex/auth.
 */
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const DEFAULT_PORT = 1455;
const REDIRECT_PATH = "/auth/callback";
const SCOPE = "openid profile email offline_access";

export interface StartOpenAIAuthOptions {
  /**
   * Loopback port the local callback server binds to. Default 1455 — matches
   * the Codex CLI client registration. Override only if 1455 is occupied AND
   * you know the alternate redirect URI is registered for the client.
   */
  port?: number;
  /**
   * Skip auto-launching the system browser. The caller is responsible for
   * opening the URL surfaced via `onAuthorizeURL`.
   */
  manualOpen?: boolean;
  /**
   * Hook fired with the constructed authorize URL — useful for CLI prompts
   * that want to print the URL alongside (or instead of) launching a browser.
   */
  onAuthorizeURL?: (url: string) => void;
  /**
   * Optional label persisted on the returned OAuthCredential for routing /
   * logging. Common values: "chatgpt-personal", "<email>".
   */
  label?: string;
  /**
   * Abort the wait for the browser callback. Useful for CLI cancel hooks.
   */
  signal?: AbortSignal;
  /**
   * Override originator string sent to the authorize endpoint. Default
   * "ai-core". Some clients may want to mimic upstream tool names.
   */
  originator?: string;
}

export async function startOpenAIAuth(
  options: StartOpenAIAuthOptions = {}
): Promise<OAuthCredential> {
  const port = options.port ?? DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
  const pkce = generatePKCE();
  const state = crypto.randomBytes(32).toString("base64url");

  const authorizeURL = buildAuthorizeURL({
    redirectUri,
    challenge: pkce.challenge,
    state,
    originator: options.originator ?? "ai-core",
  });

  options.onAuthorizeURL?.(authorizeURL);

  const callbackPromise = waitForCallback({
    port,
    expectedState: state,
    signal: options.signal,
  });

  if (!options.manualOpen) {
    openBrowser(authorizeURL);
  }

  const code = await callbackPromise;
  return exchangeCodeForToken({
    code,
    verifier: pkce.verifier,
    redirectUri,
    label: options.label,
  });
}

export async function refreshOpenAIToken(
  refreshToken: string,
  options: { label?: string } = {}
): Promise<OAuthCredential> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth refresh failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = (await response.json()) as TokenResponse;
  return tokenResponseToCredential(json, options.label, refreshToken);
}

export class OpenAIOAuthError extends Error {
  readonly status?: number;
  readonly body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = "OpenAIOAuthError";
    this.status = status;
    this.body = body;
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

function tokenResponseToCredential(
  json: TokenResponse,
  label: string | undefined,
  fallbackRefreshToken?: string
): OAuthCredential {
  const credential: OAuthCredential = {
    type: "oauth",
    provider: ProviderID.OpenAI,
    accessToken: json.access_token,
  };
  const refreshToken = json.refresh_token ?? fallbackRefreshToken;
  if (refreshToken) credential.refreshToken = refreshToken;
  if (typeof json.expires_in === "number") {
    credential.expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
  }
  if (label) credential.credentialLabel = label;
  return credential;
}

function buildAuthorizeURL(opts: {
  redirectUri: string;
  challenge: string;
  state: string;
  originator: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: SCOPE,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state: opts.state,
    originator: opts.originator,
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(opts: {
  code: string;
  verifier: string;
  redirectUri: string;
  label?: string;
}): Promise<OAuthCredential> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: opts.verifier,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth token exchange failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = (await response.json()) as TokenResponse;
  return tokenResponseToCredential(json, opts.label);
}

interface PKCEPair {
  verifier: string;
  challenge: string;
}

function generatePKCE(): PKCEPair {
  const allowed =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(43);
  let verifier = "";
  for (let i = 0; i < 43; i++) {
    verifier += allowed[bytes[i] % allowed.length];
  }
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function waitForCallback(opts: {
  port: number;
  expectedState: string;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        const message = errorDescription
          ? `${error}: ${errorDescription}`
          : error;
        res
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end(callbackPage("Authorization failed", escapeHTML(message)));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError(`OpenAI OAuth authorization failed: ${message}`));
        });
        return;
      }
      if (!code || !state || state !== opts.expectedState) {
        res
          .writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          .end(callbackPage("Invalid callback", "Missing or mismatched state."));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError("OpenAI OAuth callback missing or invalid state/code"));
        });
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          callbackPage(
            "Authorization complete",
            "You can close this tab and return to the CLI."
          )
        );
      finish(() => {
        server.close();
        resolve(code);
      });
    });

    server.on("error", (err) => {
      finish(() => reject(err));
    });
    server.listen(opts.port, "127.0.0.1");

    if (opts.signal) {
      const onAbort = () => {
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError("OpenAI OAuth flow aborted"));
        });
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function callbackPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHTML(
    title
  )}</title><body style="font-family:system-ui;padding:2rem"><h1>${escapeHTML(
    title
  )}</h1><p>${body}</p></body>`;
}

function escapeHTML(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c
  );
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true,
      }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Browser launch is best-effort; the URL is also surfaced via onAuthorizeURL.
  }
}
