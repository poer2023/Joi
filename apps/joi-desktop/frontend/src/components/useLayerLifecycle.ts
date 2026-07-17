import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  '[data-layer-initial-focus]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let nextLayerID = 0;
const activeLayerStack: number[] = [];

function removeLayerFromStack(layerID: number) {
  const index = activeLayerStack.lastIndexOf(layerID);
  if (index >= 0) activeLayerStack.splice(index, 1);
}

function isTopLayer(layerID: number) {
  return activeLayerStack[activeLayerStack.length - 1] === layerID;
}

type LayerLifecycleOptions = {
  active?: boolean;
  canDismiss?: () => boolean;
  exitDuration?: number;
  restoreFocus?: boolean;
  trapFocus?: boolean;
};

type LayerLifecycleResult<T extends HTMLElement> = {
  isClosing: boolean;
  requestClose: () => boolean;
  surfaceRef: RefObject<T | null>;
};

function visibleFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => (
    !element.hasAttribute('disabled')
    && element.getAttribute('aria-hidden') !== 'true'
    && element.getClientRects().length > 0
  ));
}

function reducedMotionPreferred() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useLayerLifecycle<T extends HTMLElement>(
  onDismiss: () => void,
  {
    active = true,
    canDismiss = () => true,
    exitDuration = 140,
    restoreFocus = true,
    trapFocus = true,
  }: LayerLifecycleOptions = {},
): LayerLifecycleResult<T> {
  const surfaceRef = useRef<T | null>(null);
  const layerIDRef = useRef(0);
  if (layerIDRef.current === 0) layerIDRef.current = ++nextLayerID;
  const dismissRef = useRef(onDismiss);
  const canDismissRef = useRef(canDismiss);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  dismissRef.current = onDismiss;
  canDismissRef.current = canDismiss;

  const requestClose = useCallback(() => {
    if (closingRef.current || !canDismissRef.current()) return false;
    closingRef.current = true;
    if (reducedMotionPreferred()) {
      dismissRef.current();
      return true;
    }
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      dismissRef.current();
    }, exitDuration);
    return true;
  }, [exitDuration]);

  useEffect(() => {
    if (!active) {
      closingRef.current = false;
      setIsClosing(false);
      return undefined;
    }

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layerID = layerIDRef.current;
    removeLayerFromStack(layerID);
    activeLayerStack.push(layerID);
    const focusFrame = window.requestAnimationFrame(() => {
      if (!isTopLayer(layerID)) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      const [firstFocusable] = visibleFocusableElements(surface);
      const preferredFocus = surface.querySelector<HTMLElement>('[data-layer-initial-focus]');
      (preferredFocus ?? firstFocusable ?? surface).focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopLayer(layerID)) return;
      const surface = surfaceRef.current;
      if (!surface) return;
      if (closingRef.current) {
        if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (!trapFocus || event.key !== 'Tab') return;

      const focusable = visibleFocusableElements(surface);
      if (focusable.length === 0) {
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !surface.contains(activeElement))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (activeElement === last || !surface.contains(activeElement))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      const wasTopLayer = isTopLayer(layerID);
      removeLayerFromStack(layerID);
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      closingRef.current = false;
      if (wasTopLayer && restoreFocus && previousFocus?.isConnected) {
        window.requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
      }
    };
  }, [active, requestClose, restoreFocus, trapFocus]);

  return { isClosing, requestClose, surfaceRef };
}

export function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(reducedMotionPreferred);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return reducedMotion;
}
