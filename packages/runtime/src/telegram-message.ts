export const TELEGRAM_FORMATTED_TEXT_MAX_CHARACTERS = 4_096;
export const TELEGRAM_PLAIN_TEXT_MAX_CHARACTERS = 4_096;
export const TELEGRAM_MEDIA_GROUP_MAX_ITEMS = 10;

export type TelegramFormattedSendPayload = {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number | string } | Array<{ message_id?: number | string }>;
};

export type TelegramFormattedSendResult = {
  ok: boolean;
  status: number;
  statusText: string;
  method: 'sendMessage';
  payload: TelegramFormattedSendPayload;
  usedPlainTextFallback: boolean;
  formattedMessageError?: string;
};

export type TelegramFormattedSendOptions = {
  apiBaseURL: string;
  token: string;
  chatID: string | number;
  text: string;
  disableLinkPreview?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export type TelegramRemoteImage = {
  alt: string;
  url: string;
};

export type TelegramMessagePlan = {
  text: string;
  images: TelegramRemoteImage[];
};

export type TelegramRichSendResult = {
  ok: boolean;
  status: number;
  statusText: string;
  method: 'sendMessage' | 'sendPhoto' | 'sendMediaGroup';
  payload: TelegramFormattedSendPayload;
  usedPlainTextFallback: boolean;
  messageIDs: string[];
  mediaCount: number;
  textSent: boolean;
};

/**
 * Regular Telegram messages render in older and current clients. Convert the
 * model's CommonMark-shaped output to Telegram's documented HTML subset while
 * preserving paragraphs, line breaks, headings, lists, quotes, code and
 * tables. Bot API 10.1 Rich Messages are intentionally not the default yet:
 * pre-June 2026 clients can accept them from the API but display them blank.
 */
export async function postTelegramFormattedText(options: TelegramFormattedSendOptions): Promise<TelegramFormattedSendResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const apiBaseURL = options.apiBaseURL.replace(/\/+$/, '');
  const source = limitTelegramText(options.text, TELEGRAM_FORMATTED_TEXT_MAX_CHARACTERS);
  const formattedResult = await postTelegramMethod(fetchImpl, apiBaseURL, options.token, {
    chat_id: options.chatID,
    text: markdownToTelegramHTML(source),
    parse_mode: 'HTML',
    ...(options.disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
  }, options.signal);
  if (formattedResult.ok) return { ...formattedResult, usedPlainTextFallback: false };

  // A concrete 400/404 response means Telegram did not accept the formatted
  // message. It is safe to retry once as unformatted text without risking a
  // duplicate. Network, timeout, 429, and 5xx outcomes remain ambiguous and
  // must never trigger a second send.
  if (![400, 404].includes(formattedResult.status)) {
    return { ...formattedResult, usedPlainTextFallback: false };
  }

  const plainResult = await postTelegramMethod(fetchImpl, apiBaseURL, options.token, {
    chat_id: options.chatID,
    text: limitTelegramText(options.text, TELEGRAM_PLAIN_TEXT_MAX_CHARACTERS),
    ...(options.disableLinkPreview ? { link_preview_options: { is_disabled: true } } : {}),
  }, options.signal);
  return {
    ...plainResult,
    usedPlainTextFallback: true,
    formattedMessageError: formattedResult.payload.description || `formatted sendMessage failed with HTTP ${formattedResult.status}`,
  };
}

/**
 * Send model output using Telegram's native message types. Remote Markdown
 * images become photos instead of text links; other CommonMark remains a
 * regular formatted message. Telegram fetches remote images itself, so Joi
 * does not download model-supplied URLs into the local network boundary.
 */
export async function postTelegramMessage(options: TelegramFormattedSendOptions): Promise<TelegramRichSendResult> {
  const plan = planTelegramMessage(options.text);
  if (plan.images.length === 0) {
    const textResult = await postTelegramFormattedText(options);
    return richResult(textResult, telegramMessageIDs(textResult.payload), 0, textResult.ok);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const apiBaseURL = options.apiBaseURL.replace(/\/+$/, '');
  const messageIDs: string[] = [];
  let textSent = false;
  let lastResult: TelegramFormattedSendResult | TelegramJSONSendResult | undefined;

  if (plan.text.trim()) {
    const textResult = await postTelegramFormattedText({ ...options, text: plan.text });
    lastResult = textResult;
    messageIDs.push(...telegramMessageIDs(textResult.payload));
    if (!textResult.ok) return richResult(textResult, messageIDs, 0, false);
    textSent = true;
  }

  let mediaCount = 0;
  for (let offset = 0; offset < plan.images.length; offset += TELEGRAM_MEDIA_GROUP_MAX_ITEMS) {
    const batch = plan.images.slice(offset, offset + TELEGRAM_MEDIA_GROUP_MAX_ITEMS);
    const batchResult = batch.length === 1
      ? await postTelegramJSONMethod(fetchImpl, apiBaseURL, options.token, 'sendPhoto', {
          chat_id: options.chatID,
          photo: batch[0].url,
          ...(batch[0].alt ? { caption: limitTelegramText(batch[0].alt, 1_024) } : {}),
        }, options.signal)
      : await postTelegramJSONMethod(fetchImpl, apiBaseURL, options.token, 'sendMediaGroup', {
          chat_id: options.chatID,
          media: batch.map((image) => ({
            type: 'photo',
            media: image.url,
            ...(image.alt ? { caption: limitTelegramText(image.alt, 1_024) } : {}),
          })),
        }, options.signal);
    lastResult = batchResult;

    if (batchResult.ok) {
      messageIDs.push(...telegramMessageIDs(batchResult.payload));
      mediaCount += batch.length;
      continue;
    }

    // A concrete client rejection means the album was not accepted. Retry its
    // members individually so one invalid URL does not suppress every other
    // image. Ambiguous network/5xx outcomes are never replayed.
    if (batch.length > 1 && [400, 404].includes(batchResult.status)) {
      let explicitFailure: TelegramJSONSendResult | undefined;
      for (const image of batch) {
        const photoResult = await postTelegramJSONMethod(fetchImpl, apiBaseURL, options.token, 'sendPhoto', {
          chat_id: options.chatID,
          photo: image.url,
          ...(image.alt ? { caption: limitTelegramText(image.alt, 1_024) } : {}),
        }, options.signal);
        lastResult = photoResult;
        if (photoResult.ok) {
          messageIDs.push(...telegramMessageIDs(photoResult.payload));
          mediaCount += 1;
        } else if ([400, 404].includes(photoResult.status)) {
          explicitFailure ||= photoResult;
        } else {
          return richResult(photoResult, messageIDs, mediaCount, textSent);
        }
      }
      if (explicitFailure) return richResult(explicitFailure, messageIDs, mediaCount, textSent);
      continue;
    }
    return richResult(batchResult, messageIDs, mediaCount, textSent);
  }

  if (!lastResult) {
    return richResult({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      method: 'sendMessage',
      payload: { ok: false, description: 'Telegram message has no sendable text or media.' },
      usedPlainTextFallback: false,
    }, messageIDs, mediaCount, textSent);
  }
  return richResult(lastResult, messageIDs, mediaCount, textSent);
}

export function planTelegramMessage(value: string): TelegramMessagePlan {
  const images: TelegramRemoteImage[] = [];
  let fenced = false;
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const text = lines.map((line) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return line;
    }
    if (fenced) return line;
    return line.replace(/!\[([^\]\n]*)\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gi, (match, rawAlt, rawURL) => {
      const url = safeTelegramPhotoURL(String(rawURL));
      if (!url) return match;
      images.push({ alt: String(rawAlt || '').trim(), url });
      return '';
    });
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, images };
}

export function markdownToTelegramHTML(value: string): string {
  const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const fence = line.match(/^```([A-Za-z0-9_+-]+)?\s*$/);
    if (fence) {
      const language = fence[1]?.replace(/[^A-Za-z0-9_+-]/g, '') || '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const escapedCode = escapeTelegramHTML(code.join('\n'));
      output.push(language
        ? `<pre><code class="language-${language}">${escapedCode}</code></pre>`
        : `<pre>${escapedCode}</pre>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      output.push(`<pre>${escapeTelegramHTML(renderPlainTable(headers, rows))}</pre>`);
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      output.push(`<b>${renderInlineMarkdown(heading[1].trim())}</b>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(renderInlineMarkdown(lines[index].replace(/^>\s?/, '')));
        index += 1;
      }
      output.push(`<blockquote>${quote.join('\n')}</blockquote>`);
      continue;
    }

    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (list) {
      const task = list[3].match(/^\[([ xX])\]\s+(.+)$/);
      const prefix = task
        ? (task[1].toLowerCase() === 'x' ? '☑' : '☐')
        : /\d/.test(list[2]) ? list[2].replace(/[)]$/, '.') : '•';
      output.push(`${escapeTelegramHTML(prefix)} ${renderInlineMarkdown(task?.[2] || list[3])}`);
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      output.push('────────');
      index += 1;
      continue;
    }

    output.push(renderInlineMarkdown(line));
    index += 1;
  }

  return output.join('\n');
}

export function limitTelegramText(value: string, maxCharacters: number): string {
  const text = String(value ?? '');
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) return text;
  if (maxCharacters <= 1) return characters.slice(0, maxCharacters).join('');
  return `${characters.slice(0, maxCharacters - 1).join('')}…`;
}

function renderInlineMarkdown(value: string): string {
  const protectedTokens: string[] = [];
  const token = (html: string) => {
    const marker = `\uE000${protectedTokens.length}\uE001`;
    protectedTokens.push(html);
    return marker;
  };
  const protectedSource = String(value ?? '').replace(
    /(`[^`\n]+`|!?\[[^\]\n]+\]\([^)\n]+\))/g,
    (match) => {
      if (match.startsWith('`')) return token(`<code>${escapeTelegramHTML(match.slice(1, -1))}</code>`);
      const link = match.match(/^!?\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? safeTelegramHref(link[2].trim()) : '';
      if (!link || !href) return match;
      return token(`<a href="${escapeTelegramHTMLAttribute(href)}">${renderInlineMarkdown(link[1])}</a>`);
    },
  );
  let html = escapeTelegramHTML(protectedSource)
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_\n]+)__/g, '<b>$1</b>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<i>$2</i>');
  html = html.replace(/\uE000(\d+)\uE001/g, (_, rawIndex) => protectedTokens[Number(rawIndex)] || '');
  return html;
}

function escapeTelegramHTML(value: string): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeTelegramHTMLAttribute(value: string): string {
  return escapeTelegramHTML(value).replace(/"/g, '&quot;');
}

function safeTelegramHref(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:', 'tg:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeTelegramPhotoURL(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isTableStart(lines: string[], index: number): boolean {
  return looksLikeTableRow(lines[index] || '')
    && index + 1 < lines.length
    && /^(\s*\|?)\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function looksLikeTableRow(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length > 1;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderPlainTable(headers: string[], rows: string[][]): string {
  const plainRows = [headers, ...rows].map((row) => row.map(stripInlineMarkdown));
  const columnCount = Math.max(0, ...plainRows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, column) => (
    Math.max(3, ...plainRows.map((row) => Array.from(row[column] || '').length))
  ));
  const renderRow = (row: string[]) => widths.map((width, column) => padEndCharacters(row[column] || '', width)).join(' | ');
  return [
    renderRow(plainRows[0] || []),
    widths.map((width) => '-'.repeat(width)).join('-|-'),
    ...plainRows.slice(1).map(renderRow),
  ].join('\n');
}

function stripInlineMarkdown(value: string): string {
  return String(value ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\|\|([^|]+)\|\|/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

function padEndCharacters(value: string, width: number): string {
  const length = Array.from(value).length;
  return length >= width ? value : `${value}${' '.repeat(width - length)}`;
}

async function postTelegramMethod(
  fetchImpl: typeof fetch,
  apiBaseURL: string,
  token: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Omit<TelegramFormattedSendResult, 'usedPlainTextFallback' | 'formattedMessageError'>> {
  const result = await postTelegramJSONMethod(fetchImpl, apiBaseURL, token, 'sendMessage', body, signal);
  return { ...result, method: 'sendMessage' };
}

type TelegramJSONSendResult = Omit<TelegramFormattedSendResult, 'method' | 'usedPlainTextFallback' | 'formattedMessageError'> & {
  method: 'sendMessage' | 'sendPhoto' | 'sendMediaGroup';
};

async function postTelegramJSONMethod(
  fetchImpl: typeof fetch,
  apiBaseURL: string,
  token: string,
  method: TelegramJSONSendResult['method'],
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TelegramJSONSendResult> {
  const response = await fetchImpl(`${apiBaseURL}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({ ok: false, description: 'Telegram returned non-JSON.' })) as TelegramFormattedSendPayload;
  return {
    ok: response.ok && payload.ok === true,
    status: response.status,
    statusText: response.statusText,
    method,
    payload,
  };
}

function telegramMessageIDs(payload: TelegramFormattedSendPayload): string[] {
  const results = Array.isArray(payload.result) ? payload.result : payload.result ? [payload.result] : [];
  return results.map((item) => String(item.message_id ?? '').trim()).filter(Boolean);
}

function richResult(
  result: TelegramFormattedSendResult | TelegramJSONSendResult,
  messageIDs: string[],
  mediaCount: number,
  textSent: boolean,
): TelegramRichSendResult {
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    method: result.method,
    payload: result.payload,
    usedPlainTextFallback: 'usedPlainTextFallback' in result ? result.usedPlainTextFallback : false,
    messageIDs,
    mediaCount,
    textSent,
  };
}
