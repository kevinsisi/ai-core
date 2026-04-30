import type { ProviderID } from "../schema.js";

export type ProviderAuthType = "api" | "oauth" | "pool";

export interface ApiKeyCredential {
  type: "api";
  provider: ProviderID;
  apiKey: string;
  baseURL?: string;
  organization?: string;
  credentialLabel?: string;
}

export interface OAuthCredential {
  type: "oauth";
  provider: ProviderID;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  baseURL?: string;
  credentialLabel?: string;
}

export interface PoolCredential {
  type: "pool";
  provider: ProviderID;
  credentialLabel?: string;
}

export type ProviderCredential = ApiKeyCredential | OAuthCredential | PoolCredential;

/**
 * Returns true when the credential's `expiresAt` (if any) is at or past the
 * current time, accounting for `leewayMs` so callers can refresh slightly
 * ahead of the hard expiry. When `expiresAt` is missing or unparseable the
 * credential is treated as not-yet-expired — callers should fall back to a
 * 401-driven refresh in that case.
 *
 * Defaults to a 60-second leeway so a token that expires "right now" while
 * the request is in flight is not considered still-valid.
 */
export function isOAuthCredentialExpired(
  credential: OAuthCredential,
  leewayMs = 60_000
): boolean {
  if (!credential.expiresAt) return false;
  const exp = Date.parse(credential.expiresAt);
  if (Number.isNaN(exp)) return false;
  return Date.now() + leewayMs >= exp;
}
