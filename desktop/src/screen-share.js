// @ts-check
"use strict";

/**
 * getDisplayMedia() in Electron needs the app to choose the source. On macOS 15+ we hand that
 * to the system picker; elsewhere we show our own window of screens and windows with previews.
 */
const { BrowserWindow, desktopCapturer, ipcMain } = require("electron");
const path = require("node:path");

/**
 * @param {{ session: Electron.Session, isTrusted: (url: string) => boolean, getWindow: () => BrowserWindow | null }} opts
 */
function installScreenSharePicker({ session, isTrusted, getWindow }) {
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!isTrusted(request.securityOrigin || request.frame?.url || "")) return callback({});
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 320, height: 200 },
          fetchWindowIcons: true,
        });
        const id = await choose(getWindow(), sources);
        const source = sources.find((s) => s.id === id);
        if (!source) return callback({});
        // System audio can only be captured on Windows.
        callback({ video: source, audio: request.audioRequested && process.platform === "win32" ? "loopback" : undefined });
      } catch {
        callback({});
      }
    },
    // WORKLIO_SYSTEM_PICKER=0 forces Worklio's own picker on macOS too (for testing it).
    { useSystemPicker: process.env.WORKLIO_SYSTEM_PICKER !== "0" },
  );
}

/**
 * @param {BrowserWindow | null} parent
 * @param {Electron.DesktopCapturerSource[]} sources
 * @returns {Promise<string | null>}
 */
function choose(parent, sources) {
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: parent ?? undefined,
      modal: Boolean(parent),
      width: 720,
      height: 560,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "Share your screen",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const list = sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      thumbnail: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : "",
    }));
    let settled = false;
    /** @param {string | null} id */
    const finish = (id) => {
      if (settled) return;
      settled = true;
      ipcMain.removeHandler("picker:sources");
      ipcMain.removeListener("picker:choose", onChoose);
      if (!picker.isDestroyed()) picker.close();
      resolve(id);
    };
    /** @param {Electron.IpcMainEvent} event @param {unknown} id */
    const onChoose = (event, id) => {
      if (event.sender !== picker.webContents) return;
      finish(typeof id === "string" && list.some((s) => s.id === id) ? id : null);
    };
    ipcMain.removeHandler("picker:sources");
    ipcMain.handle("picker:sources", (event) => (event.sender === picker.webContents ? list : []));
    ipcMain.on("picker:choose", onChoose);
    picker.on("closed", () => finish(null));
    picker.webContents.on("will-navigate", (e) => e.preventDefault());
    picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    picker.setMenu(null);
    picker.once("ready-to-show", () => picker.show());
    void picker.loadURL("worklio-app://ui/picker.html");
  });
}

module.exports = { installScreenSharePicker };
