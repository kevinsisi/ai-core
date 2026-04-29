import {
  ProviderID
} from "./chunk-ROU2NLPU.js";

// src/provider/auth/openai.ts
import { spawn } from "child_process";
import * as crypto from "crypto";
import * as http from "http";
var CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
var ISSUER = "https://auth.openai.com";
var DEFAULT_PORT = 1455;
var REDIRECT_PATH = "/auth/callback";
var SCOPE = "openid profile email offline_access";
async function startOpenAIAuth(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
  const pkce = generatePKCE();
  const state = crypto.randomBytes(32).toString("base64url");
  const authorizeURL = buildAuthorizeURL({
    redirectUri,
    challenge: pkce.challenge,
    state,
    originator: options.originator ?? "ai-core"
  });
  options.onAuthorizeURL?.(authorizeURL);
  const callbackPromise = waitForCallback({
    port,
    expectedState: state,
    signal: options.signal
  });
  if (!options.manualOpen) {
    openBrowser(authorizeURL);
  }
  const code = await callbackPromise;
  return exchangeCodeForToken({
    code,
    verifier: pkce.verifier,
    redirectUri,
    label: options.label
  });
}
async function refreshOpenAIToken(refreshToken, options = {}) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth refresh failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = await response.json();
  return tokenResponseToCredential(json, options.label, refreshToken);
}
var OpenAIOAuthError = class extends Error {
  status;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "OpenAIOAuthError";
    this.status = status;
    this.body = body;
  }
};
function tokenResponseToCredential(json, label, fallbackRefreshToken) {
  const credential = {
    type: "oauth",
    provider: ProviderID.OpenAI,
    accessToken: json.access_token
  };
  const refreshToken = json.refresh_token ?? fallbackRefreshToken;
  if (refreshToken) credential.refreshToken = refreshToken;
  if (typeof json.expires_in === "number") {
    credential.expiresAt = new Date(Date.now() + json.expires_in * 1e3).toISOString();
  }
  if (label) credential.credentialLabel = label;
  return credential;
}
function buildAuthorizeURL(opts) {
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
    originator: opts.originator
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}
async function exchangeCodeForToken(opts) {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: CLIENT_ID,
      code_verifier: opts.verifier
    })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OpenAIOAuthError(
      `OpenAI OAuth token exchange failed (${response.status})`,
      response.status,
      text
    );
  }
  const json = await response.json();
  return tokenResponseToCredential(json, opts.label);
}
function generatePKCE() {
  const allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.randomBytes(43);
  let verifier = "";
  for (let i = 0; i < 43; i++) {
    verifier += allowed[bytes[i] % allowed.length];
  }
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
function waitForCallback(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn) => {
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
        const message = errorDescription ? `${error}: ${errorDescription}` : error;
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("Authorization failed", escapeHTML(message)));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError(`OpenAI OAuth authorization failed: ${message}`));
        });
        return;
      }
      if (!code || !state || state !== opts.expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage("Invalid callback", "Missing or mismatched state."));
        finish(() => {
          server.close();
          reject(new OpenAIOAuthError("OpenAI OAuth callback missing or invalid state/code"));
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(
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
function callbackPage(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHTML(
    title
  )}</title><body style="font-family:system-ui;padding:2rem"><h1>${escapeHTML(
    title
  )}</h1><p>${body}</p></body>`;
}
function escapeHTML(s) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c] ?? c
  );
}
function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
        windowsVerbatimArguments: true
      }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
  }
}

export {
  startOpenAIAuth,
  refreshOpenAIToken,
  OpenAIOAuthError
};
//# sourceMappingURL=chunk-X3XZ7O7J.js.map