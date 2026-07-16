const retryableReadTools = new Set(['find_roots', 'observe_ui', 'read_text', 'wait_for']);
const successorCaptureFailure = /capture[_ ]timeout|capture timed out|capture failed/i;

export function shouldRetryPiComputerUseFailure(tool: string, error: unknown, signalAborted = false): boolean {
  if (signalAborted || !retryableReadTools.has(tool)) return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return /capture[_ ]timeout|capture timed out|helper.*unavailable|daemon.*unavailable|econnrefused|socket.*(?:closed|refused|unavailable)|helpertransporterror/i.test(message);
}

/**
 * A write may have reached the UI before Pi fails while collecting its
 * successor screenshot. Joi must never replay that write. It may only obtain
 * a fresh semantic observation and report the recovered postcondition.
 */
export function shouldRecoverPiWriteSuccessorFailure(tool: string, error: unknown, signalAborted = false): boolean {
  if (signalAborted || tool !== 'act_ui') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return successorCaptureFailure.test(message);
}
