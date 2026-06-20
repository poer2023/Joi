import { desktopBindingMethods, type DesktopBindings } from './desktop-api';

export const desktopIpcMethods = desktopBindingMethods;

export type DesktopIpcMethod = keyof DesktopBindings;

export type JoiInvokeRequest = {
  method: DesktopIpcMethod;
  payload?: unknown;
};

export type RunEventCallback = (event: unknown) => void;
