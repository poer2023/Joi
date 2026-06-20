type RuntimeEventCallback = (...data: unknown[]) => void;
type ElectronRuntimeWindow = Window & {
  joi?: {
    onRunEvent?: (callback: RuntimeEventCallback) => () => void;
  };
};

export function eventsOn<TEvent = unknown>(eventName: string, callback: (event: TEvent) => void): () => void {
  const electronWindow = window as ElectronRuntimeWindow;
  if (eventName === 'joi:run:event' && electronWindow.joi?.onRunEvent) {
    return electronWindow.joi.onRunEvent((event) => callback(event as TEvent));
  }

  return () => {};
}

export function windowSetMinSize(width: number, height: number): void {
  void width;
  void height;
  // Electron sets min size in main; browser preview has no native window API.
}
