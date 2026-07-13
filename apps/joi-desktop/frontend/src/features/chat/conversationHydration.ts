export function resolveConversationRoom<T extends { id: string; conversation_id?: string }>(
  rooms: readonly T[] | undefined,
  currentConversationID: string,
  currentRoomID: string,
): T | null {
  if (!rooms?.length) return null;
  return (currentConversationID
    ? rooms.find((room) => room.conversation_id === currentConversationID)
    : undefined)
    ?? rooms.find((room) => room.id === currentRoomID)
    ?? rooms[0];
}

export function messagesForConversationHydration<T>(
  settledMessages: readonly T[],
  restoredThreadMessages: readonly T[],
): T[] {
  return [...(settledMessages.length > 0 ? settledMessages : restoredThreadMessages)];
}

export function shouldRestoreThreadMessages(settledMessageCount: number, visibleThreadCount: number): boolean {
  return settledMessageCount === 0 && visibleThreadCount > 0;
}
