// @ts-check
"use strict";

/**
 * A transparent, click-through, always-on-top window over the screen I'm sharing, showing
 * everyone's annotations (Slack-style). It loads the server's /desktop/annotations page and is
 * excluded from screen capture, so viewers don't see each stroke twice.
 */
const { BrowserWindow, ipcMain, screen } = require("electron");
const path = require("node:path");

/**
 * @param {{ getWindow: () => BrowserWindow | null, serverOrigin: () => string | null, lastSharedDisplayId: () => string | null }} deps
 */
function installAnnotationOverlay({ getWindow, serverOrigin, lastSharedDisplayId }) {
  /** @type {BrowserWindow | null} */
  let overlay = null;
  /** @type {unknown[]} ops received before the overlay page finished loading */
  let pending = [];
  let ready = false;

  const fromMain = (/** @type {Electron.IpcMainEvent} */ event) => event.sender === getWindow()?.webContents;

  /** The display being shared: the picker's choice, else the one whose pixel size matches, else the app's. */
  function sharedDisplay(width, height) {
    const all = screen.getAllDisplays();
    const picked = lastSharedDisplayId();
    const byId = picked ? all.find((d) => String(d.id) === picked) : undefined;
    if (byId) return byId;
    const bySize = all.find(
      (d) =>
        Math.abs(d.size.width * d.scaleFactor - width) < 4 && Math.abs(d.size.height * d.scaleFactor - height) < 4,
    );
    if (bySize) return bySize;
    const win = getWindow();
    return win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  }

  function close() {
    ready = false;
    pending = [];
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
    overlay = null;
  }

  ipcMain.on("annotate:start", (event, info) => {
    if (!fromMain(event)) return;
    const origin = serverOrigin();
    if (!origin) return;
    close();
    const width = Number(info?.width) || 0;
    const height = Number(info?.height) || 0;
    const { bounds } = sharedDisplay(width, height);
    overlay = new BrowserWindow({
      ...bounds,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Keep the layer out of the screen share itself (viewers already draw it on their side).
    overlay.setContentProtection(true);
    overlay.webContents.on("will-navigate", (e) => e.preventDefault());
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    overlay.webContents.once("did-finish-load", () => {
      ready = true;
      for (const op of pending) overlay?.webContents.send("annotate:op", op);
      pending = [];
      overlay?.showInactive();
    });
    void overlay.loadURL(`${origin}/desktop/annotations`);
  });

  ipcMain.on("annotate:op", (event, op) => {
    if (!fromMain(event) || !overlay || overlay.isDestroyed()) return;
    if (!op || typeof op !== "object") return;
    if (ready) overlay.webContents.send("annotate:op", op);
    else if (pending.length < 500) pending.push(op);
  });

  ipcMain.on("annotate:stop", (event) => {
    if (fromMain(event)) close();
  });

  return { close };
}

module.exports = { installAnnotationOverlay };
