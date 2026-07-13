export type ACPPluginModelOption = {
  id: string;
  name?: string;
};

export function mergeACPPluginModels(...inventories: Array<ACPPluginModelOption[] | undefined>): ACPPluginModelOption[] {
  const models = new Map<string, ACPPluginModelOption>();
  for (const inventory of inventories) {
    for (const model of inventory || []) {
      const id = model.id.trim();
      if (!id || models.has(id)) continue;
      models.set(id, { id, name: model.name?.trim() || id });
    }
  }
  return [...models.values()];
}

export function selectACPPluginModel(models: ACPPluginModelOption[], candidates: Array<string | undefined>): string {
  const ids = new Set(models.map((model) => model.id));
  for (const candidate of candidates) {
    const id = candidate?.trim() || '';
    if (id && ids.has(id)) return id;
  }
  return models[0]?.id || candidates.find((candidate) => Boolean(candidate?.trim()))?.trim() || 'default';
}

export function reasoningEffortFromACPModel(modelID: string): string | undefined {
  const effort = modelID.trim().match(/\[([^\]]+)]$/)?.[1]?.toLowerCase();
  return effort && ['none', 'low', 'medium', 'high'].includes(effort) ? effort : undefined;
}

export function acpPluginModelConfig(providerID: string, modelID: string) {
  return {
    provider: providerID,
    base_url: '',
    name: modelID,
    reasoning_effort: reasoningEffortFromACPModel(modelID),
    timeout_seconds: 300,
    max_retries: 0,
  };
}
