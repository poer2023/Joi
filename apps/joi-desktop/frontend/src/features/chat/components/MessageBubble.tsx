import { useState } from 'react';
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
  const showThreadMarker = isAssistant && threadAnnotation;
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
        <div className="message-bubble-frame">
          <div className="message-bubble">
            {content ? <MarkdownContent content={content} /> : null}
            {attachments.length ? <MessageAttachmentGrid attachments={attachments} expandImages={isAssistant} /> : null}
            {!content && attachments.length === 0 ? <p className="message-skeleton">正在组织回复...</p> : null}
          </div>
          <MessageBubbleActions content={content} createdAt={item.createdAt} />
        </div>
        {showThreadMarker ? (
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

export function MessageBubbleActions({ content, createdAt }: { content: string; createdAt?: string }) {
  const [copied, setCopied] = useState(false);
  const timestamp = formatMessageTimestamp(createdAt);

  if (!content && !timestamp) return null;

  async function copyMessage() {
    if (!content) return;
    try {
      await navigator.clipboard?.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="message-bubble-actions" aria-label="消息操作">
      {timestamp ? <time dateTime={createdAt}>{timestamp}</time> : null}
      {content ? (
        <button type="button" onClick={() => void copyMessage()}>
          {copied ? '已复制' : '复制'}
        </button>
      ) : null}
    </div>
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

function formatMessageTimestamp(value?: string): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MessageAttachmentGrid({
  attachments,
  expandImages = false,
}: {
  attachments: NonNullable<ChatMessageRenderItem['attachments']>;
  expandImages?: boolean;
}) {
  return (
    <div className="message-attachment-grid">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`message-attachment message-attachment-${attachment.kind}${expandImages && attachment.kind === 'image' && attachment.previewUrl ? ' message-attachment-expanded-image' : ''}`}
        >
          {attachment.kind === 'image' && attachment.previewUrl ? <img src={attachment.previewUrl} alt="" /> : null}
          {attachment.kind === 'video' && attachment.previewUrl ? <video src={attachment.previewUrl} controls playsInline preload="metadata" /> : null}
          {attachment.kind === 'audio' && attachment.previewUrl ? <audio src={attachment.previewUrl} controls preload="metadata" /> : null}
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

function AttachmentGlyph({ kind }: { kind: 'image' | 'video' | 'audio' | 'file' }) {
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
  if (kind === 'audio') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M9 18V6l9-2v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="15" cy="16" r="3" />
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
