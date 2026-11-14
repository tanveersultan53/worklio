/**
 * The Worklio desktop app (Electron, see /desktop) exposes a tiny bridge on `window.worklioDesktop`.
 * In a browser it's absent and everything here falls back to plain web behaviour.
 */
type DesktopBridge = {
  platform: string;
  /** Bring the app window to the front. */
  focus: () => void;
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
