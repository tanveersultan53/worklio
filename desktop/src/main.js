// @ts-check
"use strict";

/**
 * Worklio desktop: a locked-down Chromium window around the user's Worklio server.
 * Everything the app does lives on the server; this shell adds what a browser tab can't:
 * a dock/taskbar badge, notifications while another app is in front, a screen-share picker,
 * background running, and the OS mic/camera prompts.
 */
const {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
} = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const config = require("./config");
const { attachContextMenu } = require("./context-menu");
const { buildMenu } = require("./menu");
const { installScreenSharePicker } = require("./screen-share");
const { normalize, probe, needsSecureContextOverride } = require("./server");
const { createTray } = require("./tray");

const UI_SCHEME = "worklio-app";
const UI_ROOT = path.join(__dirname, "ui");
const SETUP_URL = `${UI_SCHEME}://ui/setup.html`;
const ICON = path.join(__dirname, "assets", "icon.png");

/** Permissions the Worklio page may have. Everything else (geolocation, MIDI, USB…) is refused. */
const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "fullscreen",
  "clipboard-read",
  "clipboard-sanitized-write",
  "display-capture",
  "speaker-selection",
  "idle-detection",
]);

protocol.registerSchemesAsPrivileged([{ scheme: UI_SCHEME, privileges: { standard: true, secure: true } }]);

/** The server we load: WORKLIO_URL wins (handy for development), then what the user chose. */
function serverOrigin() {
  const fromEnv = process.env.WORKLIO_URL ? normalize(process.env.WORKLIO_URL) : null;
  return fromEnv ?? config.get().serverUrl ?? null;
}

/** @param {string | undefined | null} url */
function isServerUrl(url) {
  const origin = serverOrigin();
  if (!url || !origin) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** @param {string} url */
const isOwnUi = (url) => url.startsWith(`${UI_SCHEME}://ui/`);

/** @param {string} url */
function openExternal(url) {
  try {
    const { protocol: p } = new URL(url);
    if (p === "https:" || p === "http:" || p === "mailto:") void shell.openExternal(url);
  } catch {
    // Not a URL; ignore.
  }
}

// getUserMedia only works on secure origins. A self-hosted server on plain http over the LAN
// (http://192.168.1.10:3000) would lose huddles, so treat exactly that one origin as secure.
const startOrigin = serverOrigin();
if (startOrigin && needsSecureContextOverride(startOrigin)) {
  app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", startOrigin);
}

if (process.platform === "win32") app.setAppUserModelId("io.worklio.desktop");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /** @type {BrowserWindow | null} */
  let win = null;
  let quitting = false;
  let unread = 0;
  /** @type {ReturnType<typeof createTray> | null} */
  let tray = null;

  const showWindow = () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (process.platform === "darwin") app.focus({ steal: true });
  };

  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    // The main window only really closes when quitting.
    if (process.platform !== "darwin") app.quit();
  });

  app.whenReady().then(() => {
    protocol.handle(UI_SCHEME, (request) => {
      const { pathname } = new URL(request.url);
      const file = path.normalize(path.join(UI_ROOT, decodeURIComponent(pathname)));
      if (!file.startsWith(UI_ROOT + path.sep)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    lockDownSession();
    registerIpc();
    buildMenu({ showSetup, getWindow: () => win });
    if (process.platform !== "darwin") tray = createTray({ icon: ICON, show: showWindow, quit: () => app.quit() });
    createWindow();
  });

  function lockDownSession() {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (!isServerUrl(details.requestingUrl) || !ALLOWED_PERMISSIONS.has(permission)) return callback(false);
      if (permission === "media" && process.platform === "darwin") {
        // Ask macOS first so the system privacy prompt appears; the page's own prompt is ours to grant.
        const types = /** @type {{ mediaTypes?: string[] }} */ (details).mediaTypes ?? [];
        const asks = [];
        if (types.includes("audio")) asks.push(systemPreferences.askForMediaAccess("microphone"));
        if (types.includes("video")) asks.push(systemPreferences.askForMediaAccess("camera"));
        void Promise.all(asks).then((answers) => callback(answers.every(Boolean)));
        return;
      }
      callback(true);
    });
    ses.setPermissionCheckHandler((_wc, permission, origin) => isServerUrl(origin) && ALLOWED_PERMISSIONS.has(permission));
    ses.setDevicePermissionHandler(() => false);
    installScreenSharePicker({ session: ses, isTrusted: isServerUrl, getWindow: () => win });

    // A plain "Worklio" token so the server and its logs can tell desktop traffic apart.
    ses.setUserAgent(`${ses.getUserAgent()} WorklioDesktop/${app.getVersion()}`);
  }

  function registerIpc() {
    ipcMain.on("worklio:focus", (event) => {
      if (isServerUrl(event.senderFrame?.url)) showWindow();
    });
    ipcMain.handle("setup:state", (event) => {
      if (!isOwnUi(event.senderFrame?.url ?? "")) return null;
      return { current: config.get().serverUrl ?? "", fromEnv: Boolean(process.env.WORKLIO_URL) };
    });
    ipcMain.handle("setup:connect", async (event, input) => {
      if (!isOwnUi(event.senderFrame?.url ?? "")) return { ok: false, error: "Not allowed." };
      const origin = typeof input === "string" ? normalize(input) : null;
      if (!origin) return { ok: false, error: "Enter a web address, like chat.example.com." };
      const result = await probe(origin);
      if (!result.ok) return result;
      const previous = config.get().serverUrl;
      config.set({ serverUrl: origin });
      // The secure-origin switch is read at startup, so an http LAN server needs a restart.
      if (needsSecureContextOverride(origin) && origin !== startOrigin) {
        app.relaunch();
        app.exit(0);
        return { ok: true };
      }
      if (origin !== previous || win?.webContents.getURL() === SETUP_URL) void win?.loadURL(origin);
      return { ok: true };
    });
    ipcMain.on("setup:cancel", (event) => {
      const origin = serverOrigin();
      if (isOwnUi(event.senderFrame?.url ?? "") && origin) void win?.loadURL(origin);
    });
  }

  function showSetup() {
    showWindow();
    void win?.loadURL(SETUP_URL);
  }

  /** Last saved size/position, dropped if that spot is no longer on any screen. */
  function savedBounds() {
    const saved = config.get().window;
    const width = Math.max(saved?.width ?? 1280, 720);
    const height = Math.max(saved?.height ?? 820, 500);
    if (saved?.x === undefined || saved?.y === undefined) return { width, height };
    const bounds = { x: saved.x, y: saved.y, width, height };
    const area = screen.getDisplayMatching(bounds).workArea;
    const visible =
      bounds.x < area.x + area.width - 80 &&
      bounds.x + bounds.width > area.x + 80 &&
      bounds.y < area.y + area.height - 80 &&
      bounds.y + bounds.height > area.y;
    return visible ? bounds : { width, height };
  }

  function createWindow() {
    const bounds = savedBounds();
    win = new BrowserWindow({
      ...bounds,
      minWidth: 720,
      minHeight: 500,
      show: false,
      title: "Worklio",
      icon: process.platform === "linux" ? ICON : undefined,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1d21" : "#ffffff",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        // Keep realtime and huddle audio running while the window is in the background.
        backgroundThrottling: false,
      },
    });
    if (config.get().window?.maximized) win.maximize();
    win.once("ready-to-show", () => win?.show());

    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // Same-server links stay in the app; everything else goes to the default browser.
      if (isServerUrl(url)) void wc.loadURL(url);
      else openExternal(url);
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      if (isServerUrl(url) || isOwnUi(url)) return;
      event.preventDefault();
      openExternal(url);
    });
    wc.on("will-attach-webview", (event) => event.preventDefault());
    wc.on("page-title-updated", (_event, title) => onTitle(title));
    wc.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted */ || isOwnUi(url)) return;
      void wc.loadURL(`${UI_SCHEME}://ui/offline.html?error=${encodeURIComponent(description)}`);
    });
    attachContextMenu(wc, { openExternal, isDev: !app.isPackaged });

    let saveTimer = /** @type {NodeJS.Timeout | undefined} */ (undefined);
    const saveBounds = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
        config.set({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } });
      }, 400);
    };
    win.on("resize", saveBounds);
    win.on("move", saveBounds);
    win.on("maximize", saveBounds);
    win.on("unmaximize", saveBounds);
    win.on("focus", () => win?.flashFrame(false));

    win.on("close", (event) => {
      if (quitting) return;
      // Keep running so messages and calls still arrive; the dock icon or tray brings it back.
      event.preventDefault();
      if (win?.isFullScreen()) {
        win.once("leave-full-screen", () => win?.hide());
        win.setFullScreen(false);
      } else {
        win?.hide();
      }
    });
    win.on("closed", () => {
      win = null;
    });

    const origin = serverOrigin();
    void win.loadURL(origin ?? SETUP_URL);
  }

  ipcMain.on("offline:retry", (event) => {
    const origin = serverOrigin();
    if (isOwnUi(event.senderFrame?.url ?? "") && origin) void win?.loadURL(origin);
  });
  ipcMain.on("offline:change-server", (event) => {
    if (isOwnUi(event.senderFrame?.url ?? "")) showSetup();
  });

  /**
   * The web app keeps "(3) Acme · Worklio" in the title; mirror the count on the dock/taskbar.
   * Other titles (the "📞 Leo is calling…" flash) leave the badge alone.
   * @param {string} title
   */
  function onTitle(title) {
    if (!title.endsWith("· Worklio")) return;
    const match = /^\((\d+)\)\s/.exec(title);
    const count = match ? Number(match[1]) : 0;
    if (count === unread) return;
    const grew = count > unread;
    unread = count;
    app.setBadgeCount(count);
    if (process.platform === "win32") win?.setOverlayIcon(count ? badgeDot() : null, count ? `${count} unread` : "");
    tray?.setUnread(count);
    if (grew && win && !win.isFocused()) {
      if (process.platform === "darwin") app.dock?.bounce("informational");
      else win.flashFrame(true);
    }
  }

  /** @type {Electron.NativeImage | null} */
  let dot = null;
  /** A small red dot for the Windows taskbar overlay. */
  function badgeDot() {
    if (dot) return dot;
    const size = 16;
    const buf = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        const alpha = Math.max(0, Math.min(1, 7.5 - d));
        const i = (y * size + x) * 4;
        // BGRA
        buf[i] = 0x5f;
        buf[i + 1] = 0x37;
        buf[i + 2] = 0xe5;
        buf[i + 3] = Math.round(alpha * 255);
      }
    }
    dot = nativeImage.createFromBitmap(buf, { width: size, height: size });
    return dot;
  }
}
