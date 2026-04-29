import type { ApiKeyCredential, OAuthCredential } from "../auth/index.js";
import { getBuiltInProvider } from "../models.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

export class OpenAIProviderAdapter extends OpenAICompatibleAdapter {
  readonly provider = getBuiltInProvider("openai")!;

  protected readonly defaultBaseURL = "https://api.openai.com/v1";
  protected readonly nativeToolProvider = "openai";

  constructor(credential: ApiKeyCredential | OAuthCredential) {
    super(credential);
  }

  protected override buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    if (this.credential.type === "api" && this.credential.organization) {
      headers["OpenAI-Organization"] = this.credential.organization;
    }
    return headers;
  }
}
