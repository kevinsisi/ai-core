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
