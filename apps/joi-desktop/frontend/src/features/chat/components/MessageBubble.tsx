import type { ChatMessageRenderItem } from '../types';
import { MarkdownContent } from './MarkdownContent';

export function MessageBubble({
  assistantAvatarSrc,
  formatAssistantContent,
  item,
  onOpenTrace,
  traceSummary,
}: {
  assistantAvatarSrc?: string;
  formatAssistantContent?: (content: string) => string;
  item: ChatMessageRenderItem;
  onOpenTrace?: (runId: string) => void;
  traceSummary?: string;
}) {
  const isAssistant = item.role === 'assistant';
  const content = isAssistant && formatAssistantContent ? formatAssistantContent(item.content) : item.content;
  const showTraceLink = isAssistant && item.runId && onOpenTrace;
  return (
    <article className={`message-row ${isAssistant ? 'assistant-message' : 'user-message'}${item.streaming ? ' streaming-message' : ''}`}>
      {isAssistant ? (
        assistantAvatarSrc ? <img className="message-avatar assistant" src={assistantAvatarSrc} alt="Joi" /> : <div className="message-avatar assistant">J</div>
      ) : (
        <div className="message-avatar">你</div>
      )}
      <div className="message-stack">
        <div className="message-bubble">
          {content ? <MarkdownContent content={content} /> : <p className="message-skeleton">正在组织回复...</p>}
        </div>
        {showTraceLink ? (
          <button className="message-run-summary" type="button" onClick={() => onOpenTrace(item.runId!)}>
            {traceSummary || '查看 Run'}
          </button>
        ) : null}
      </div>
    </article>
  );
}
