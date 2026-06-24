export function mergeAssistantTextChunk(current: string, chunk: string): string {
  const currentText = textValue(current);
  const chunkText = textValue(chunk);
  if (!chunkText) return currentText;
  if (!currentText) return chunkText.trimStart();

  const comparableCurrent = currentText.trimStart();
  const comparableChunk = chunkText.trimStart();
  if (comparableChunk.length > comparableCurrent.length && comparableChunk.startsWith(comparableCurrent)) {
    return comparableChunk;
  }
  if (comparableChunk === comparableCurrent && comparableCurrent.length > 8) {
    return currentText;
  }
  return `${currentText}${chunkText}`.trimStart();
}

export function mergeAssistantTextChunks(chunks: string[]): string {
  return chunks.reduce((content, chunk) => mergeAssistantTextChunk(content, chunk), '');
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
