export const NEW_CONVERSATION_SUBMISSION_KEY = '__new_conversation__';

export function submissionKeyForConversation(conversationID: string): string {
  return conversationID.trim() || NEW_CONVERSATION_SUBMISSION_KEY;
}

export function withSubmissionActive(
  activeKeys: ReadonlySet<string>,
  submissionKey: string,
  active: boolean,
): Set<string> {
  const next = new Set(activeKeys);
  if (active) next.add(submissionKey);
  else next.delete(submissionKey);
  return next;
}

export function shouldQueueConversationSubmission(
  activeKeys: ReadonlySet<string>,
  conversationID: string,
): boolean {
  return activeKeys.has(submissionKeyForConversation(conversationID));
}

export function executionEventIsVisible({
  eventConversationID,
  currentConversationID,
  activeSubmissionKeys,
}: {
  eventConversationID: string;
  currentConversationID: string;
  activeSubmissionKeys: ReadonlySet<string>;
}): boolean {
  if (eventConversationID) {
    if (currentConversationID) return eventConversationID === currentConversationID;
    return activeSubmissionKeys.has(NEW_CONVERSATION_SUBMISSION_KEY)
      && !activeSubmissionKeys.has(eventConversationID);
  }
  return activeSubmissionKeys.size <= 1;
}
