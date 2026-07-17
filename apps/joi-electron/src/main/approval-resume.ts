const confirmationEnvelopeKeys = new Set([
  'server',
  'tool',
  'arguments',
  'operation_id',
  'product_task_id',
  'affected_paths',
  'external_target',
  'reversible',
  'requested_action',
]);

export function approvalResumeCapabilityInput(input: Record<string, unknown>): Record<string, unknown> {
  const nested = isRecord(input.arguments) ? input.arguments : undefined;
  if (!nested) return { ...input };
  const editedParameters = Object.fromEntries(
    Object.entries(input).filter(([key]) => !confirmationEnvelopeKeys.has(key)),
  );
  return { ...nested, ...editedParameters };
}

export function approvalResumeContinuationMessage(
  capability: string,
  output: Record<string, unknown>,
): string {
  return [
    `The user approved the pending ${capability} capability once.`,
    'Joi runtime has already executed that approved side effect exactly once.',
    `Approved tool result: ${JSON.stringify(output)}`,
    'Continue the original user task from this result. Do not repeat the approved side effect.',
    'Only read-only verification tools are available during this continuation. Return the final user-facing result.',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
