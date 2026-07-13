type CapabilityPresentationInput = {
  enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type CapabilityBackend = 'implemented' | 'alias' | 'planned';

export function capabilityBackend(capability: Pick<CapabilityPresentationInput, 'metadata'>): CapabilityBackend {
  const backend = capability.metadata?.backend;
  if (backend === 'alias' || backend === 'planned') return backend;
  return 'implemented';
}

export function capabilityBackendLabel(backend: CapabilityBackend): string {
  if (backend === 'planned') return '计划中';
  if (backend === 'alias') return '别名';
  return '已实现';
}

export function capabilityStatusLabel(capability: CapabilityPresentationInput): string {
  if (!capability.enabled) return '已停用';
  const backend = capabilityBackend(capability);
  if (backend === 'planned') return '未接后端';
  if (backend === 'alias') return '别名';
  return '已实现';
}
