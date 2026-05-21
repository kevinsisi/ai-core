import { CapabilityNotSupportedError } from "../client/types.js";
import type { GenerateParams, GenerateResponse, ImageGenParams, ImageGenResponse } from "../client/types.js";
import { defaultProviderPriority, getBuiltInModel } from "./models.js";
import type { ProviderAdapter, RoutePolicy, RoutedProviderSelection } from "./types.js";

function credentialRef(adapter: ProviderAdapter): string {
  const label = adapter.credential.credentialLabel;
  if (label && label.trim() !== "") return label;

  if (adapter.credential.type === "api") {
    const suffix = adapter.credential.apiKey.slice(-4);
    return `api:${suffix}`;
  }

  if (adapter.credential.type === "oauth") {
    return "oauth";
  }

  return "pool";
}

function matchesCapabilities(
  model: NonNullable<ReturnType<typeof getBuiltInModel>>,
  required?: RoutePolicy["requiredCapabilities"]
) {
  if (!required) return true;

  return Object.entries(required).every(([key, value]) => {
    if (typeof value !== "boolean") return true;
    return model.capabilities[key as keyof typeof model.capabilities] === value;
  });
}

function supportsRequiredMethod(adapter: ProviderAdapter, method?: RoutePolicy["requiredMethod"]): boolean {
  if (!method) return true;
  // The optional method is defined on ProviderAdapter as `method?(...)`; index
  // access via the union widens to `unknown`, so we cast to a callable check.
  const fn = (adapter as unknown as Record<string, unknown>)[method];
  return typeof fn === "function";
}

export interface RoutedExecution {
  selection: RoutedProviderSelection;
  response: GenerateResponse;
}

export interface RoutedStream {
  selection: RoutedProviderSelection;
  stream: AsyncGenerator<string, void, unknown>;
}

export interface RoutedImageGen {
  selection: RoutedProviderSelection;
  response: ImageGenResponse;
}

export class ProviderRouter {
  constructor(private readonly adapters: ProviderAdapter[]) {}

  select(policy: RoutePolicy = {}): RoutedProviderSelection {
    return this.selectAdapter(policy).selection;
  }

  /**
   * Select an adapter and execute generateContent against it.
   *
   * If the caller did not set `policy.preferredModel`, `params.model` is used
   * as the model preference so the routing target matches the explicit request.
   *
   * No silent provider/model fallback: when the resolved selection picks a
   * different model than the caller asked for, the policy must have opted in
   * via `allowCrossProviderFallback` / `allowCrossModelFallback`.
   */
  async execute(
    params: GenerateParams,
    policy: RoutePolicy = {}
  ): Promise<RoutedExecution> {
    const effectivePolicy: RoutePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
    };
    const candidates = this.selectAdapterCandidates(effectivePolicy);

    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const { adapter, selection } = candidates[index];
      try {
        const response = await adapter.generateContent({ ...params, model: selection.model });
        return { selection, response };
      } catch (err) {
        lastError = err;
        if (!this.canTryNextCandidate(candidates, index, effectivePolicy)) {
          throw err;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Provider execution failed");
  }

  /**
   * Mirror of execute() for streaming. Selection runs eagerly so the caller
   * can inspect which provider/model resolved before iterating the stream.
   */
  executeStream(params: GenerateParams, policy: RoutePolicy = {}): RoutedStream {
    const effectivePolicy: RoutePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
      requiredCapabilities: { streaming: true, ...(policy.requiredCapabilities ?? {}) },
    };
    const { adapter, selection } = this.selectAdapter(effectivePolicy);
    const stream = adapter.streamContent({ ...params, model: selection.model });
    return { selection, stream };
  }

  async executeImageGen(
    params: ImageGenParams,
    policy: RoutePolicy = {}
  ): Promise<RoutedImageGen> {
    const effectivePolicy: RoutePolicy = {
      ...policy,
      preferredModel: policy.preferredModel ?? params.model,
      requiredCapabilities: { imageOutput: true, ...(policy.requiredCapabilities ?? {}) },
      requiredMethod: "imageGen",
    };
    const candidates = this.selectAdapterCandidates(effectivePolicy);

    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const { adapter, selection } = candidates[index];
      if (!adapter.imageGen) {
        lastError = new CapabilityNotSupportedError(selection.provider, "imageGen");
        continue;
      }
      try {
        const response = await adapter.imageGen({ ...params, model: selection.model });
        return { selection, response };
      } catch (err) {
        lastError = err;
        if (!this.canTryNextCandidate(candidates, index, effectivePolicy)) {
          throw err;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new CapabilityNotSupportedError("provider", "imageGen");
  }

  private selectAdapter(policy: RoutePolicy): {
    adapter: ProviderAdapter;
    selection: RoutedProviderSelection;
  } {
    const [candidate] = this.selectAdapterCandidates(policy);
    if (!candidate) {
      throw new Error("No provider/model combination matches the routing policy");
    }
    return candidate;
  }

  private selectAdapterCandidates(policy: RoutePolicy): Array<{
    adapter: ProviderAdapter;
    selection: RoutedProviderSelection;
  }> {
    const preferredProviders = policy.preferredProviders ?? [...defaultProviderPriority];
    const orderedProviders = [
      ...preferredProviders,
      ...((policy.allowCrossProviderFallback ? policy.fallbackProviders : []) ?? []),
    ];

    const seen = new Set<string>();
    const uniqueProviders = orderedProviders.filter((providerID) => {
      if (seen.has(providerID)) return false;
      seen.add(providerID);
      return true;
    });

    const preferredBuiltInModel = policy.preferredModel
      ? getBuiltInModel(policy.preferredModel)
      : undefined;

    for (const providerID of uniqueProviders) {
      if (
        preferredBuiltInModel &&
        preferredBuiltInModel.provider !== providerID &&
        !policy.allowCrossProviderFallback
      ) {
        continue;
      }

      const providerAdapters = this.adapters
        .filter((item) => item.provider.id === providerID)
        .filter((item) => supportsRequiredMethod(item, policy.requiredMethod));
      if (providerAdapters.length === 0) continue;

      const adaptersToTry = policy.allowSameProviderCredentialFallback
        ? providerAdapters
        : providerAdapters.slice(0, 1);

      for (const adapter of adaptersToTry) {
        if (policy.preferredModel) {
          const model = adapter.getModel(policy.preferredModel);
          if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
            const candidate = {
              adapter,
              selection: {
                provider: providerID,
                model: model.id,
                credentialType: adapter.credential.type,
                credentialRef: credentialRef(adapter),
              },
            };
            if (!policy.allowCrossProviderFallback && !policy.allowSameProviderCredentialFallback) {
              return [candidate];
            }
            return [
              candidate,
              ...this.selectFallbackCandidates(policy, uniqueProviders, providerID, adapter),
            ];
          }

          if (!policy.allowCrossModelFallback) {
            continue;
          }
        }

        const models = adapter.provider.models.filter(
          (model) => adapter.supports(model.id) && matchesCapabilities(model, policy.requiredCapabilities)
        );
        if (models.length === 0) {
          continue;
        }

        const candidate = {
          adapter,
          selection: {
            provider: providerID,
            model: models[0].id,
            credentialType: adapter.credential.type,
            credentialRef: credentialRef(adapter),
          },
        };
        if (!policy.allowCrossProviderFallback && !policy.allowSameProviderCredentialFallback) {
          return [candidate];
        }
        return [
          candidate,
          ...this.selectFallbackCandidates(policy, uniqueProviders, providerID, adapter),
        ];
      }
    }

    throw new Error("No provider/model combination matches the routing policy");
  }

  private selectFallbackCandidates(
    policy: RoutePolicy,
    orderedProviders: string[],
    selectedProviderID: string,
    selectedAdapter: ProviderAdapter
  ): Array<{
    adapter: ProviderAdapter;
    selection: RoutedProviderSelection;
  }> {
    const candidates: Array<{
      adapter: ProviderAdapter;
      selection: RoutedProviderSelection;
    }> = [];

    for (const providerID of orderedProviders) {
      const providerChanged = providerID !== selectedProviderID;
      if (providerChanged && !policy.allowCrossProviderFallback) continue;

      const providerAdapters = this.adapters
        .filter((item) => item.provider.id === providerID)
        .filter((item) => supportsRequiredMethod(item, policy.requiredMethod));
      const adaptersToTry = policy.allowSameProviderCredentialFallback
        ? providerAdapters
        : providerAdapters.slice(0, 1);

      for (const adapter of adaptersToTry) {
        if (adapter === selectedAdapter) continue;
        if (!providerChanged && !policy.allowSameProviderCredentialFallback) continue;

        const model = policy.preferredModel ? adapter.getModel(policy.preferredModel) : undefined;
        if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
          candidates.push({
            adapter,
            selection: {
              provider: providerID,
              model: model.id,
              credentialType: adapter.credential.type,
              credentialRef: credentialRef(adapter),
            },
          });
          continue;
        }

        if (policy.preferredModel && !policy.allowCrossModelFallback) continue;

        const [fallbackModel] = adapter.provider.models.filter(
          (item) => adapter.supports(item.id) && matchesCapabilities(item, policy.requiredCapabilities)
        );
        if (!fallbackModel) continue;

        candidates.push({
          adapter,
          selection: {
            provider: providerID,
            model: fallbackModel.id,
            credentialType: adapter.credential.type,
            credentialRef: credentialRef(adapter),
          },
        });
      }
    }

    return candidates;
  }

  private canTryNextCandidate(
    candidates: Array<{ selection: RoutedProviderSelection }>,
    currentIndex: number,
    policy: RoutePolicy
  ): boolean {
    const current = candidates[currentIndex];
    const next = candidates[currentIndex + 1];
    if (!current || !next) return false;
    if (current.selection.provider !== next.selection.provider) {
      return policy.allowCrossProviderFallback === true;
    }
    return policy.allowSameProviderCredentialFallback === true;
  }
}
