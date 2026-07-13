export function messagesForConversationHydration<T>(
  settledMessages: readonly T[],
  restoredThreadMessages: readonly T[],
): T[] {
  return [...(settledMessages.length > 0 ? settledMessages : restoredThreadMessages)];
}

export function shouldRestoreThreadMessages(settledMessageCount: number, visibleThreadCount: number): boolean {
  return settledMessageCount === 0 && visibleThreadCount > 0;
}
