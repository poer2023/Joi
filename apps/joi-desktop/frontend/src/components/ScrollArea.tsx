import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

type ScrollAreaElement = 'div' | 'aside' | 'main' | 'section';

type ScrollAreaProps = HTMLAttributes<HTMLElement> & {
  as?: ScrollAreaElement;
  children: ReactNode;
  contentClassName?: string;
  stickToBottom?: boolean;
  stickToBottomKey?: string | number;
};

const TRACK_INSET = 10;
const MIN_THUMB_HEIGHT = 24;
const THUMB_HEIGHT_SCALE = 0.62;

export function ScrollArea({
  as: Component = 'div',
  children,
  className = '',
  contentClassName = '',
  stickToBottom = false,
  stickToBottomKey,
  ...props
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ maxScroll: number; maxTop: number; startScrollTop: number; startY: number } | null>(null);
  const programmaticScrollRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState({ canScroll: false, thumbHeight: MIN_THUMB_HEIGHT, thumbTop: TRACK_INSET });

  const updateMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { clientHeight, scrollHeight, scrollTop } = viewport;
    if (stickToBottom && !programmaticScrollRef.current) {
      shouldStickToBottomRef.current = scrollHeight - clientHeight - scrollTop < 80;
    }
    const canScroll = scrollHeight > clientHeight + 1;
    if (!canScroll) {
      setMetrics((current) => current.canScroll ? { canScroll: false, thumbHeight: MIN_THUMB_HEIGHT, thumbTop: TRACK_INSET } : current);
      return;
    }

    const trackHeight = Math.max(0, clientHeight - TRACK_INSET * 2);
    const proportionalHeight = (clientHeight / scrollHeight) * trackHeight;
    const thumbHeight = Math.max(MIN_THUMB_HEIGHT, proportionalHeight * THUMB_HEIGHT_SCALE);
    const maxTop = Math.max(0, trackHeight - thumbHeight);
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const thumbTop = TRACK_INSET + (scrollTop / maxScroll) * maxTop;
    setMetrics({ canScroll, thumbHeight, thumbTop });
  }, [stickToBottom]);

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    programmaticScrollRef.current = true;
    viewport.scrollTop = viewport.scrollHeight;
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
      updateMetrics();
    });
  }, [updateMetrics]);

  useEffect(() => {
    const refreshMetrics = () => {
      if (stickToBottom && shouldStickToBottomRef.current) {
        requestAnimationFrame(scrollToBottom);
        return;
      }
      updateMetrics();
    };

    refreshMetrics();
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const resizeObserver = new ResizeObserver(refreshMetrics);
    if (viewport) resizeObserver.observe(viewport);
    if (content) resizeObserver.observe(content);
    window.addEventListener('resize', refreshMetrics);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', refreshMetrics);
    };
  }, [scrollToBottom, stickToBottom, updateMetrics]);

  useEffect(() => {
    if (!stickToBottom) return;
    shouldStickToBottomRef.current = true;
    requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom, stickToBottom, stickToBottomKey]);

  function startThumbDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const trackHeight = Math.max(0, viewport.clientHeight - TRACK_INSET * 2);
    dragRef.current = {
      maxScroll: Math.max(1, viewport.scrollHeight - viewport.clientHeight),
      maxTop: Math.max(1, trackHeight - metrics.thumbHeight),
      startScrollTop: viewport.scrollTop,
      startY: event.clientY,
    };
    setHovering(true);
    setDragging(true);
  }

  function dragThumb(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag) return;

    const deltaY = event.clientY - drag.startY;
    viewport.scrollTop = drag.startScrollTop + (deltaY / drag.maxTop) * drag.maxScroll;
  }

  function stopThumbDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  function jumpToTrack(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top - TRACK_INSET - metrics.thumbHeight / 2;
    const trackHeight = Math.max(0, viewport.clientHeight - TRACK_INSET * 2);
    const maxTop = Math.max(1, trackHeight - metrics.thumbHeight);
    const ratio = Math.min(1, Math.max(0, y / maxTop));
    viewport.scrollTop = ratio * Math.max(1, viewport.scrollHeight - viewport.clientHeight);
  }

  const rootClassName = ['scroll-area', metrics.canScroll ? 'scroll-area-can-scroll' : '', (hovering || dragging) && metrics.canScroll ? 'scroll-area-visible' : '', className].filter(Boolean).join(' ');

  return (
    <Component className={rootClassName} {...props}>
      <div ref={viewportRef} className="scroll-area-viewport" onScroll={updateMetrics}>
        <div ref={contentRef} className={`scroll-area-content ${contentClassName}`.trim()}>
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="scroll-area-hover-zone"
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => {
          if (!dragging) setHovering(false);
        }}
        onPointerDown={jumpToTrack}
      >
        <div className="scroll-area-track">
          <div
            className="scroll-area-thumb"
            style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
            onPointerDown={startThumbDrag}
            onPointerMove={dragThumb}
            onPointerUp={stopThumbDrag}
            onPointerCancel={stopThumbDrag}
          />
        </div>
      </div>
    </Component>
  );
}
