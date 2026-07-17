import { useCallback, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

type ScrollAreaElement = 'div' | 'aside' | 'main' | 'section';
type ScrollAreaAxes = 'vertical' | 'horizontal' | 'both';
type ScrollAreaTrackVisibility = 'hover' | 'always';

type ScrollAreaProps = HTMLAttributes<HTMLElement> & {
  as?: ScrollAreaElement;
  axes?: ScrollAreaAxes;
  children: ReactNode;
  contentClassName?: string;
  resetScrollKey?: string | number;
  stickToBottom?: boolean;
  stickToBottomKey?: string | number;
  trackVisibility?: ScrollAreaTrackVisibility;
  viewportAriaLabel?: string;
  viewportTabIndex?: number;
};

const TRACK_INSET = 10;
const MIN_THUMB_HEIGHT = 24;
const MIN_THUMB_WIDTH = 24;
const THUMB_SIZE_SCALE = 0.62;

type ScrollMetrics = {
  canScrollX: boolean;
  canScrollY: boolean;
  thumbHeight: number;
  thumbLeft: number;
  thumbTop: number;
  thumbWidth: number;
};

const INITIAL_SCROLL_METRICS: ScrollMetrics = {
  canScrollX: false,
  canScrollY: false,
  thumbHeight: MIN_THUMB_HEIGHT,
  thumbLeft: TRACK_INSET,
  thumbTop: TRACK_INSET,
  thumbWidth: MIN_THUMB_WIDTH,
};

function scrollMetricsEqual(current: ScrollMetrics, next: ScrollMetrics) {
  return current.canScrollX === next.canScrollX
    && current.canScrollY === next.canScrollY
    && current.thumbHeight === next.thumbHeight
    && current.thumbLeft === next.thumbLeft
    && current.thumbTop === next.thumbTop
    && current.thumbWidth === next.thumbWidth;
}

type ScrollDrag = {
  axis: 'x' | 'y';
  maxPosition: number;
  maxScroll: number;
  startPointer: number;
  startScroll: number;
};

export function ScrollArea({
  as: Component = 'div',
  axes = 'vertical',
  children,
  className = '',
  contentClassName = '',
  resetScrollKey,
  stickToBottom = false,
  stickToBottomKey,
  trackVisibility = 'hover',
  viewportAriaLabel,
  viewportTabIndex,
  ...props
}: ScrollAreaProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ScrollDrag | null>(null);
  const metricsFrameRef = useRef<number | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const previousResetScrollKeyRef = useRef(resetScrollKey);
  const programmaticScrollRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [metrics, setMetrics] = useState<ScrollMetrics>(INITIAL_SCROLL_METRICS);

  const updateMetrics = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { clientHeight, clientWidth, scrollHeight, scrollLeft, scrollTop, scrollWidth } = viewport;
    if (stickToBottom && !programmaticScrollRef.current) {
      shouldStickToBottomRef.current = scrollHeight - clientHeight - scrollTop < 80;
    }

    const canScrollY = axes !== 'horizontal' && scrollHeight > clientHeight + 1;
    const canScrollX = axes !== 'vertical' && scrollWidth > clientWidth + 1;

    const trackHeight = Math.max(0, clientHeight - TRACK_INSET * 2);
    const proportionalHeight = canScrollY ? (clientHeight / scrollHeight) * trackHeight : MIN_THUMB_HEIGHT;
    const thumbHeight = canScrollY ? Math.max(MIN_THUMB_HEIGHT, proportionalHeight * THUMB_SIZE_SCALE) : MIN_THUMB_HEIGHT;
    const maxTop = Math.max(0, trackHeight - thumbHeight);
    const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
    const thumbTop = canScrollY ? TRACK_INSET + (scrollTop / maxScrollTop) * maxTop : TRACK_INSET;

    const trackWidth = Math.max(0, clientWidth - TRACK_INSET * 2);
    const proportionalWidth = canScrollX ? (clientWidth / scrollWidth) * trackWidth : MIN_THUMB_WIDTH;
    const thumbWidth = canScrollX ? Math.max(MIN_THUMB_WIDTH, proportionalWidth * THUMB_SIZE_SCALE) : MIN_THUMB_WIDTH;
    const maxLeft = Math.max(0, trackWidth - thumbWidth);
    const maxScrollLeft = Math.max(1, scrollWidth - clientWidth);
    const thumbLeft = canScrollX ? TRACK_INSET + (scrollLeft / maxScrollLeft) * maxLeft : TRACK_INSET;

    const nextMetrics = { canScrollX, canScrollY, thumbHeight, thumbLeft, thumbTop, thumbWidth };
    setMetrics((current) => scrollMetricsEqual(current, nextMetrics) ? current : nextMetrics);
  }, [axes, stickToBottom]);

  const updateMetricsRef = useRef(updateMetrics);
  updateMetricsRef.current = updateMetrics;

  const cancelScheduledMetricsUpdate = useCallback(() => {
    if (metricsFrameRef.current !== null) {
      window.cancelAnimationFrame(metricsFrameRef.current);
      metricsFrameRef.current = null;
    }
    pendingScrollToBottomRef.current = false;
    programmaticScrollRef.current = false;
  }, []);

  const scheduleMetricsUpdate = useCallback((scrollToBottom = false) => {
    if (scrollToBottom) pendingScrollToBottomRef.current = true;
    if (metricsFrameRef.current !== null) return;

    metricsFrameRef.current = window.requestAnimationFrame(() => {
      metricsFrameRef.current = null;
      const shouldScrollToBottom = pendingScrollToBottomRef.current;
      pendingScrollToBottomRef.current = false;
      const viewport = viewportRef.current;

      if (shouldScrollToBottom && viewport) {
        programmaticScrollRef.current = true;
        viewport.scrollTop = viewport.scrollHeight;
      }

      try {
        updateMetricsRef.current();
      } finally {
        programmaticScrollRef.current = false;
      }
    });
  }, []);

  useEffect(() => {
    const refreshMetrics = () => {
      if (stickToBottom && shouldStickToBottomRef.current) {
        scheduleMetricsUpdate(true);
        return;
      }
      scheduleMetricsUpdate();
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
  }, [scheduleMetricsUpdate, stickToBottom]);

  useEffect(() => {
    if (!stickToBottom) return;
    shouldStickToBottomRef.current = true;
    scheduleMetricsUpdate(true);
  }, [scheduleMetricsUpdate, stickToBottom, stickToBottomKey]);

  useEffect(() => {
    if (Object.is(previousResetScrollKeyRef.current, resetScrollKey)) return;
    previousResetScrollKeyRef.current = resetScrollKey;
    const viewport = viewportRef.current;
    if (!viewport) return;

    cancelScheduledMetricsUpdate();
    shouldStickToBottomRef.current = false;
    programmaticScrollRef.current = true;
    try {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
    } finally {
      programmaticScrollRef.current = false;
    }
    scheduleMetricsUpdate();
  }, [cancelScheduledMetricsUpdate, resetScrollKey, scheduleMetricsUpdate]);

  useEffect(() => () => cancelScheduledMetricsUpdate(), [cancelScheduledMetricsUpdate]);

  function startThumbDrag(event: ReactPointerEvent<HTMLDivElement>, axis: 'x' | 'y') {
    const viewport = viewportRef.current;
    if (!viewport) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const trackLength = Math.max(0, (axis === 'y' ? viewport.clientHeight : viewport.clientWidth) - TRACK_INSET * 2);
    const thumbSize = axis === 'y' ? metrics.thumbHeight : metrics.thumbWidth;
    dragRef.current = {
      axis,
      maxPosition: Math.max(1, trackLength - thumbSize),
      maxScroll: Math.max(1, axis === 'y'
        ? viewport.scrollHeight - viewport.clientHeight
        : viewport.scrollWidth - viewport.clientWidth),
      startPointer: axis === 'y' ? event.clientY : event.clientX,
      startScroll: axis === 'y' ? viewport.scrollTop : viewport.scrollLeft,
    };
    setHovering(true);
    setDragging(true);
  }

  function dragThumb(event: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    if (!viewport || !drag) return;

    const pointer = drag.axis === 'y' ? event.clientY : event.clientX;
    const nextScroll = drag.startScroll + ((pointer - drag.startPointer) / drag.maxPosition) * drag.maxScroll;
    if (drag.axis === 'y') viewport.scrollTop = nextScroll;
    else viewport.scrollLeft = nextScroll;
  }

  function stopThumbDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }

  function jumpToTrack(event: ReactPointerEvent<HTMLDivElement>, axis: 'x' | 'y') {
    if (event.target !== event.currentTarget) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const thumbSize = axis === 'y' ? metrics.thumbHeight : metrics.thumbWidth;
    const pointer = axis === 'y' ? event.clientY - rect.top : event.clientX - rect.left;
    const trackLength = Math.max(0, (axis === 'y' ? viewport.clientHeight : viewport.clientWidth) - TRACK_INSET * 2);
    const maxPosition = Math.max(1, trackLength - thumbSize);
    const ratio = Math.min(1, Math.max(0, (pointer - TRACK_INSET - thumbSize / 2) / maxPosition));
    if (axis === 'y') viewport.scrollTop = ratio * Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    else viewport.scrollLeft = ratio * Math.max(1, viewport.scrollWidth - viewport.clientWidth);
  }

  function handleViewportScroll() {
    const viewport = viewportRef.current;
    if (stickToBottom && viewport && !programmaticScrollRef.current) {
      const shouldStick = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 80;
      shouldStickToBottomRef.current = shouldStick;
      if (!shouldStick) pendingScrollToBottomRef.current = false;
    }
    scheduleMetricsUpdate();
  }

  const canScroll = metrics.canScrollX || metrics.canScrollY;
  const rootClassName = [
    'scroll-area',
    `scroll-area-axes-${axes}`,
    trackVisibility === 'always' ? 'scroll-area-tracks-always' : '',
    canScroll ? 'scroll-area-can-scroll' : '',
    metrics.canScrollX ? 'scroll-area-can-scroll-x' : '',
    metrics.canScrollY ? 'scroll-area-can-scroll-y' : '',
    (hovering || dragging) && canScroll ? 'scroll-area-visible' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Component className={rootClassName} {...props}>
      <div
        ref={viewportRef}
        aria-label={viewportAriaLabel}
        className="scroll-area-viewport"
        onScroll={handleViewportScroll}
        tabIndex={viewportTabIndex}
      >
        <div ref={contentRef} className={`scroll-area-content ${contentClassName}`.trim()}>
          {children}
        </div>
      </div>
      {axes !== 'horizontal' ? (
        <div
          aria-hidden="true"
          className="scroll-area-hover-zone"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => {
            if (!dragging) setHovering(false);
          }}
          onPointerDown={(event) => jumpToTrack(event, 'y')}
        >
          <div className="scroll-area-track">
            <div
              className="scroll-area-thumb"
              style={{ height: metrics.thumbHeight, transform: `translateY(${metrics.thumbTop}px)` }}
              onPointerDown={(event) => startThumbDrag(event, 'y')}
              onPointerMove={dragThumb}
              onPointerUp={stopThumbDrag}
              onPointerCancel={stopThumbDrag}
            />
          </div>
        </div>
      ) : null}
      {axes !== 'vertical' ? (
        <div
          aria-hidden="true"
          className="scroll-area-hover-zone scroll-area-hover-zone-horizontal"
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => {
            if (!dragging) setHovering(false);
          }}
          onPointerDown={(event) => jumpToTrack(event, 'x')}
        >
          <div className="scroll-area-track scroll-area-track-horizontal">
            <div
              className="scroll-area-thumb scroll-area-thumb-horizontal"
              style={{ width: metrics.thumbWidth, transform: `translateX(${metrics.thumbLeft}px)` }}
              onPointerDown={(event) => startThumbDrag(event, 'x')}
              onPointerMove={dragThumb}
              onPointerUp={stopThumbDrag}
              onPointerCancel={stopThumbDrag}
            />
          </div>
        </div>
      ) : null}
    </Component>
  );
}
