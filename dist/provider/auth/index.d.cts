import { O as OAuthCredential } from '../../types-DG3Ftj0c.cjs';
export { A as ApiKeyCredential, P as PoolCredential, b as ProviderAuthType, d as ProviderCredential, i as isOAuthCredentialExpired } from '../../types-DG3Ftj0c.cjs';

interface StartOpenAIAuthOptions {
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
declare function startOpenAIAuth(options?: StartOpenAIAuthOptions): Promise<OAuthCredential>;
declare function refreshOpenAIToken(refreshToken: string, options?: {
    label?: string;
}): Promise<OAuthCredential>;
declare class OpenAIOAuthError extends Error {
    readonly status?: number;
    readonly body?: string;
    constructor(message: string, status?: number, body?: string);
}

export { OAuthCredential, OpenAIOAuthError, type StartOpenAIAuthOptions, refreshOpenAIToken, startOpenAIAuth };
