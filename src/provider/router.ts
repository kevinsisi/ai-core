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

export class ProviderRouter {
  constructor(private readonly adapters: ProviderAdapter[]) {}

  select(policy: RoutePolicy = {}): RoutedProviderSelection {
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

    for (const providerID of uniqueProviders) {
      const providerAdapters = this.adapters.filter((item) => item.provider.id === providerID);
      if (providerAdapters.length === 0) continue;

      const adaptersToTry = policy.allowSameProviderCredentialFallback
        ? providerAdapters
        : providerAdapters.slice(0, 1);

      for (const adapter of adaptersToTry) {
        if (policy.preferredModel) {
          const model = adapter.getModel(policy.preferredModel);
          if (model && matchesCapabilities(model, policy.requiredCapabilities)) {
            return {
              provider: providerID,
              model: model.id,
              credentialType: adapter.credential.type,
              credentialRef: credentialRef(adapter),
            };
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

        return {
          provider: providerID,
          model: models[0].id,
          credentialType: adapter.credential.type,
          credentialRef: credentialRef(adapter),
        };
      }
    }

    throw new Error("No provider/model combination matches the routing policy");
  }
}
