import type { ApiKeyCredential } from "../auth.js";
import { getBuiltInProvider } from "../models.js";
import { OpenAICompatibleAdapter } from "./openai-compatible.js";

export class OpenAIProviderAdapter extends OpenAICompatibleAdapter {
  readonly provider = getBuiltInProvider("openai")!;

  protected readonly defaultBaseURL = "https://api.openai.com/v1";
  protected readonly nativeToolProvider = "openai";

  constructor(credential: ApiKeyCredential) {
    super(credential);
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      ...super.buildHeaders(),
      ...(this.credential.organization && {
        "OpenAI-Organization": this.credential.organization,
      }),
    };
  }
}
