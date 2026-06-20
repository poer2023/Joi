import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopIpcMethod, JoiPreloadApi, RunEventCallback } from '@joi/shared-types';

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
  app: {
    getVersion(): Promise<string> {
      return ipcRenderer.invoke('joi:app:getVersion') as Promise<string>;
    },
    openExternal(url: string): Promise<void> {
      return ipcRenderer.invoke('joi:app:openExternal', url) as Promise<void>;
    },
  },
};

contextBridge.exposeInMainWorld('joi', joiApi);
