import { createHash } from 'node:crypto';

export function telegramConversationID(
  chatID: string | number,
  externalThreadID?: string | number,
): string {
  const chat = String(chatID).trim() || 'unknown';
  const thread = String(externalThreadID ?? '').trim();
  const externalKey = thread ? `chat:${chat}:thread:${thread}` : `chat:${chat}`;
  const slug = externalKey.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'unknown';
  const digest = createHash('sha256').update(externalKey).digest('hex').slice(0, 12);
  return `conv_telegram_${slug}_${digest}`;
}
