import type { ConversationSummary, MessengerRoom, PersonaMessengerSnapshot } from '../../api/desktop';

function normalized(value?: string) {
  return value?.trim().toLowerCase() ?? '';
}

export function selectPrimaryJoiRoom(messenger: PersonaMessengerSnapshot | null): MessengerRoom | null {
  if (!messenger?.rooms.length) return null;

  const joiPersonaIDs = new Set(
    messenger.personas
      .filter((persona) => {
        const name = normalized(persona.display_name);
        const handle = normalized(persona.handle).replace(/^@/, '');
        return name === 'joi' || handle === 'joi' || handle.startsWith('joi-') || normalized(persona.id).includes('joi');
      })
      .map((persona) => persona.id),
  );

  return messenger.rooms.find((room) => room.type === 'project_dm' && Boolean(room.persona_id && joiPersonaIDs.has(room.persona_id)))
    ?? messenger.rooms.find((room) => normalized(room.title) === 'joi')
    ?? messenger.rooms.find((room) => normalized(room.id).includes('joi'))
    ?? messenger.rooms.find((room) => room.type === 'private_hub')
    ?? messenger.rooms[0];
}

export function visibleSingleAgentConversations(
  conversations: ConversationSummary[],
  messenger: PersonaMessengerSnapshot | null,
): ConversationSummary[] {
  const primaryRoom = selectPrimaryJoiRoom(messenger);
  const hiddenRoomConversationIDs = new Set(
    (messenger?.rooms ?? [])
      .filter((room) => room.id !== primaryRoom?.id)
      .map((room) => room.conversation_id)
      .filter((id): id is string => Boolean(id)),
  );
  return conversations.filter((conversation) => !hiddenRoomConversationIDs.has(conversation.id));
}

export function filterSingleAgentConversations(
  conversations: ConversationSummary[],
  query: string,
): ConversationSummary[] {
  const needle = normalized(query);
  if (!needle) return conversations;
  return conversations.filter((conversation) => [
    conversation.title,
    conversation.last_message,
    conversation.channel,
    conversation.topic,
  ].some((value) => normalized(value).includes(needle)));
}

export function conversationChannelLabel(channel?: string) {
  switch (normalized(channel)) {
    case 'imessage': return 'iMessage';
    case 'telegram': return 'Telegram';
    case 'desktop': return 'Desktop';
    default: return channel?.trim() || 'Joi';
  }
}
