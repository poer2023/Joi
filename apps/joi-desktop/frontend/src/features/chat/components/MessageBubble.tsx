import type { ChatMessageRenderItem, MessageThreadAnnotation } from '../types';
import { MarkdownContent } from './MarkdownContent';

export function MessageBubble({
  assistantAvatarSrc,
  formatAssistantContent,
  highlighted = false,
  item,
  onOpenThread,
  threadAnnotation,
  threadSelected = false,
}: {
  assistantAvatarSrc?: string;
  formatAssistantContent?: (content: string) => string;
  highlighted?: boolean;
  item: ChatMessageRenderItem;
  onOpenThread?: (threadId: string) => void;
  threadAnnotation?: MessageThreadAnnotation;
  threadSelected?: boolean;
}) {
  const isAssistant = item.role === 'assistant';
  const content = isAssistant && formatAssistantContent ? formatAssistantContent(item.content) : item.content;
  const attachments = item.attachments ?? [];
  return (
    <article
      className={`message-row ${isAssistant ? 'assistant-message' : 'user-message'}${item.streaming ? ' streaming-message' : ''}${highlighted ? ' message-source-highlight' : ''}`}
      data-message-id={item.id}
      data-run-id={item.runId}
    >
      {isAssistant ? (
        assistantAvatarSrc ? <img className="message-avatar assistant" src={assistantAvatarSrc} alt="Joi" /> : <div className="message-avatar assistant">J</div>
      ) : (
        <div className="message-avatar">你</div>
      )}
      <div className="message-stack">
        <div className="message-bubble">
          {content ? <MarkdownContent content={content} /> : null}
          {attachments.length ? <MessageAttachmentGrid attachments={attachments} /> : null}
          {!content && attachments.length === 0 ? <p className="message-skeleton">正在组织回复...</p> : null}
        </div>
        {threadAnnotation ? (
          <MessageThreadMarker
            annotation={threadAnnotation}
            selected={threadSelected}
            onOpenThread={onOpenThread}
          />
        ) : null}
      </div>
    </article>
  );
}

export function MessageThreadMarker({
  annotation,
  onOpenThread,
  selected,
}: {
  annotation: MessageThreadAnnotation;
  onOpenThread?: (threadId: string) => void;
  selected?: boolean;
}) {
  return (
    <button
      className={`message-thread-marker message-thread-marker-${annotation.kind}${selected ? ' active' : ''}`}
      type="button"
      onClick={() => onOpenThread?.(annotation.threadId)}
      title={`${annotation.label}：${annotation.title}`}
    >
      <span>{annotation.label}</span>
      <strong>{annotation.title}</strong>
    </button>
  );
}

function MessageAttachmentGrid({ attachments }: { attachments: NonNullable<ChatMessageRenderItem['attachments']> }) {
  return (
    <div className="message-attachment-grid">
      {attachments.map((attachment) => (
        <div key={attachment.id} className={`message-attachment message-attachment-${attachment.kind}`}>
          {attachment.kind === 'image' && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : null}
          {attachment.kind === 'video' && attachment.previewUrl ? <video src={attachment.previewUrl} muted playsInline preload="metadata" /> : null}
          {attachment.kind === 'file' || !attachment.previewUrl ? (
            <span className="message-attachment-icon" aria-hidden="true"><AttachmentGlyph kind={attachment.kind} /></span>
          ) : null}
          <span className="message-attachment-copy">
            <strong>{attachment.name}</strong>
            <small>{formatAttachmentSize(attachment.size)}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function AttachmentGlyph({ kind }: { kind: 'image' | 'video' | 'file' }) {
  if (kind === 'image') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5 5h14v14H5z" />
        <path d="m7 16 4-4 3 3 2-2 3 3" />
        <path d="M9 9h.01" />
      </svg>
    );
  }
  if (kind === 'video') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5 7h10v10H5z" />
        <path d="m15 10 4-2v8l-4-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function formatAttachmentSize(size: number) {
  if (!size) return '附件';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
