import type { KeyPool } from "../key-pool/key-pool.js";
import type { ApiKey } from "../key-pool/types.js";
import type { PlannedStepAssignment, StepDefinition } from "./types.js";

function rankHealthyKeys(keys: ApiKey[]): ApiKey[] {
  return [...keys].sort((a, b) => {
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    if (a.cooldownUntil !== b.cooldownUntil) return a.cooldownUntil - b.cooldownUntil;
    if (a.leaseUntil !== b.leaseUntil) return a.leaseUntil - b.leaseUntil;
    return a.id - b.id;
  });
}

export async function planPreferredKeys(
  pool: KeyPool,
  steps: readonly StepDefinition[]
): Promise<PlannedStepAssignment[]> {
  const now = Date.now();
  const healthyKeys = rankHealthyKeys(
    (await pool.status()).filter(
      (key) => key.isActive && key.cooldownUntil <= now && key.leaseUntil <= now
    )
  );

  const unusedHealthyKeys = [...healthyKeys];

  return steps.map((step) => {
    if (step.preferredKey) {
      const explicitPreferred = unusedHealthyKeys.find((key) => key.key === step.preferredKey);

      if (explicitPreferred) {
        const index = unusedHealthyKeys.findIndex((key) => key.key === explicitPreferred.key);
        if (index >= 0) unusedHealthyKeys.splice(index, 1);
        return {
          stepId: step.id,
          stepName: step.name,
          preferredKey: explicitPreferred.key,
          sharedFallbackRequired: false,
        };
      }

      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: step.preferredKey,
        sharedFallbackRequired: true,
      };
    }

    const nextHealthy = unusedHealthyKeys.shift();
    if (nextHealthy) {
      return {
        stepId: step.id,
        stepName: step.name,
        preferredKey: nextHealthy.key,
        sharedFallbackRequired: false,
      };
    }

    return {
      stepId: step.id,
      stepName: step.name,
      preferredKey: null,
      sharedFallbackRequired: true,
    };
  });
}
