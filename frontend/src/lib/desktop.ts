/**
 * The Worklio desktop app (Electron, see /desktop) exposes a tiny bridge on `window.worklioDesktop`.
 * In a browser it's absent and everything here falls back to plain web behaviour.
 */
/** Screen-share annotations mirrored onto the presenter's real screen (desktop app only). */
export type DesktopAnnotations = {
  /** I started sharing a whole screen of this size (device pixels): open the overlay on it. */
  start: (info: { width: number; height: number }) => void;
  /** Someone drew something (an AnnotationOp, as sent on the call). */
  op: (op: unknown) => void;
  /** I stopped sharing: close the overlay. */
  stop: () => void;
  /** Overlay page only: receive ops / resets forwarded by the desktop app. */
  onOp?: (fn: (op: unknown) => void) => () => void;
  onReset?: (fn: () => void) => () => void;
};

type DesktopBridge = {
  platform: string;
  /** Bring the app window to the front. */
  focus: () => void;
  /** Present in desktop builds that can draw annotations over the shared screen. */
  annotations?: DesktopAnnotations;
};

declare global {
  interface Window {
    worklioDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === "undefined" ? undefined : window.worklioDesktop;
}

/**
 * Is the user looking somewhere else? In a browser that means the tab is hidden. In the desktop
 * app the window often stays visible behind other apps, so losing focus counts too — that's when
 * people expect a notification from a chat app.
 */
export function isAway(): boolean {
  if (typeof document === "undefined") return false;
  return document.hidden || (desktopBridge() !== undefined && !document.hasFocus());
}

/** Bring Worklio to the front after a notification click (the desktop app needs the shell's help). */
export function bringToFront(): void {
  desktopBridge()?.focus();
  window.focus();
}
