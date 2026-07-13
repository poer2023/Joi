import type { ConnectionTest } from '../../shared-types/src/desktop-api';
import { postTelegramFormattedText } from './telegram-message.ts';

export type TelegramConnectionOptions = {
  token?: string;
  apiBaseURL?: string;
  timeoutSeconds?: number;
};

export type TelegramTestMessageOptions = TelegramConnectionOptions & {
  chatID?: string;
  allowedUserIDs?: string;
  message?: string;
};

const defaultTelegramAPIBaseURL = 'https://api.telegram.org';
const defaultTelegramTestMessage = 'Joi Desktop Telegram test';
const defaultTimeoutSeconds = 8;

export async function testTelegramConnection(options: TelegramConnectionOptions = {}): Promise<ConnectionTest> {
  const token = options.token?.trim() || '';
  if (!token) {
    return { ok: false, status: 'missing_token', error_summary: 'TELEGRAM_BOT_TOKEN is not configured' };
  }
  try {
    const response = await fetchWithTimeout(telegramBotURL(token, 'getMe', options.apiBaseURL), {
      method: 'GET',
    }, options.timeoutSeconds ?? defaultTimeoutSeconds);
    await response.arrayBuffer();
    if (!response.ok) {
      return { ok: false, status: responseStatus(response), error_summary: 'telegram getMe returned non-2xx' };
    }
    return { ok: true, status: 'succeeded' };
  } catch (error) {
    return { ok: false, status: 'failed', error_summary: sanitizeTelegramError(error, token) };
  }
}

export async function sendTestTelegramMessage(options: TelegramTestMessageOptions = {}): Promise<ConnectionTest> {
  const token = options.token?.trim() || '';
  if (!token) {
    return { ok: false, status: 'missing_token', error_summary: 'TELEGRAM_BOT_TOKEN is not configured' };
  }
  const chatID = options.chatID?.trim() || firstCSV(options.allowedUserIDs || '');
  if (!chatID) {
    return { ok: false, status: 'missing_chat_id', error_summary: 'No Telegram chat ID or allowed user ID configured' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (options.timeoutSeconds ?? defaultTimeoutSeconds) * 1000);
  try {
    const result = await postTelegramFormattedText({
      apiBaseURL: options.apiBaseURL || process.env.TELEGRAM_API_BASE_URL || defaultTelegramAPIBaseURL,
      token,
      chatID,
      text: options.message || defaultTelegramTestMessage,
      fetchImpl: fetch,
      signal: controller.signal,
    });
    if (!result.ok) {
      const status = result.statusText ? `${result.status} ${result.statusText}` : String(result.status);
      return { ok: false, status, error_summary: `telegram ${result.method} returned non-2xx` };
    }
    return { ok: true, status: 'succeeded' };
  } catch (error) {
    return { ok: false, status: 'failed', error_summary: sanitizeTelegramError(error, token) };
  } finally {
    clearTimeout(timer);
  }
}

export function telegramBotURL(token: string, method: string, apiBaseURL?: string): string {
  const baseURL = (apiBaseURL || process.env.TELEGRAM_API_BASE_URL || defaultTelegramAPIBaseURL).trim().replace(/\/+$/, '');
  return `${baseURL}/bot${token}/${method}`;
}

function firstCSV(value: string): string {
  return value.split(',').map((item) => item.trim()).find(Boolean) || '';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function responseStatus(response: Response): string {
  return response.statusText ? `${response.status} ${response.statusText}` : String(response.status);
}

function sanitizeTelegramError(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(token, '[redacted]');
}
