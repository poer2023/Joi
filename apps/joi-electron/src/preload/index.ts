import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopIpcMethod, JoiPreloadApi, RunEventCallback, TerminalSessionEvent } from '@joi/shared-types';

const joiApi: JoiPreloadApi = {
  invoke<T = unknown>(method: DesktopIpcMethod, payload?: unknown): Promise<T> {
    return ipcRenderer.invoke('joi:invoke', { method, payload }) as Promise<T>;
  },
  onRunEvent(callback: RunEventCallback): () => void {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      callback(payload);
    };
    ipcRenderer.on('joi:run:event', listener);
    return () => {
      ipcRenderer.off('joi:run:event', listener);
    };
  },
  terminal: {
    start(req) {
      return ipcRenderer.invoke('joi:terminal:start', req);
    },
    input(req) {
      return ipcRenderer.invoke('joi:terminal:input', req);
    },
    resize(req) {
      return ipcRenderer.invoke('joi:terminal:resize', req);
    },
    kill(req) {
      return ipcRenderer.invoke('joi:terminal:kill', req);
    },
    getStatus(id) {
      return ipcRenderer.invoke('joi:terminal:getStatus', id);
    },
    onEvent(callback: (event: TerminalSessionEvent) => void): () => void {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalSessionEvent) => {
        callback(payload);
      };
      ipcRenderer.on('joi:terminal:event', listener);
      return () => {
        ipcRenderer.off('joi:terminal:event', listener);
      };
    },
  },
  app: {
    getVersion(): Promise<string> {
      return ipcRenderer.invoke('joi:app:getVersion') as Promise<string>;
    },
    openExternal(url: string): Promise<void> {
      return ipcRenderer.invoke('joi:app:openExternal', url) as Promise<void>;
    },
    setWindowButtonVisibility(visible: boolean): Promise<void> {
      return ipcRenderer.invoke('joi:app:setWindowButtonVisibility', visible) as Promise<void>;
    },
  },
};

contextBridge.exposeInMainWorld('joi', joiApi);
