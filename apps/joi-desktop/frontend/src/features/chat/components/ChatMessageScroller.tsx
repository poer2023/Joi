import { MessageScroller } from '@shadcn/react/message-scroller';
import type { ReactNode } from 'react';
import { useReducedMotionPreference } from '../../../components/useLayerLifecycle';

export function ChatMessageScroller({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotionPreference();
  return (
    <MessageScroller.Provider
      autoScroll
      defaultScrollPosition="last-anchor"
      scrollEdgeThreshold={80}
      scrollPreviousItemPeek={64}
    >
      <MessageScroller.Root className="chat-thread chat-message-scroller">
        <MessageScroller.Viewport
          aria-label="聊天消息"
          className="chat-message-scroller-viewport"
          preserveScrollOnPrepend
        >
          <MessageScroller.Content
            className="chat-message-scroller-content"
            spacerClassName="chat-message-scroller-spacer"
          >
            {children}
          </MessageScroller.Content>
        </MessageScroller.Viewport>
        <MessageScroller.Button
          aria-label="跳到最新消息"
          behavior={reducedMotion ? 'auto' : 'smooth'}
          className="chat-message-scroller-button"
          direction="end"
          title="跳到最新消息"
        >
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </MessageScroller.Button>
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}
