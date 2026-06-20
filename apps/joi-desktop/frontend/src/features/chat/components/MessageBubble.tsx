import type { ChatMessageRenderItem } from '../types';
import { MarkdownContent } from './MarkdownContent';

export function MessageBubble({
  assistantAvatarSrc,
  formatAssistantContent,
  item,
}: {
  assistantAvatarSrc?: string;
  formatAssistantContent?: (content: string) => string;
  item: ChatMessageRenderItem;
}) {
  const isAssistant = item.role === 'assistant';
  const content = isAssistant && formatAssistantContent ? formatAssistantContent(item.content) : item.content;
  return (
    <article className={`message-row ${isAssistant ? 'assistant-message' : 'user-message'}${item.streaming ? ' streaming-message' : ''}`}>
      {isAssistant ? (
        assistantAvatarSrc ? <img className="message-avatar assistant" src={assistantAvatarSrc} alt="Joi" /> : <div className="message-avatar assistant">J</div>
      ) : (
        <div className="message-avatar">你</div>
      )}
      <div className="message-bubble">
        {content ? <MarkdownContent content={content} /> : <p className="message-skeleton">正在组织回复...</p>}
      </div>
    </article>
  );
}
