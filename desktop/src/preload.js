// @ts-check
"use strict";

/**
 * What pages can reach from the desktop shell. No Node and no raw IPC: the Worklio page gets
 * `window.worklioDesktop`, and only the app's own screens (worklio-app://) get `window.shell`.
 * The main process re-checks the sender of every message anyway.
 */
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "worklio-app:") {
  contextBridge.exposeInMainWorld("shell", {
    platform: process.platform,
    setupState: () => ipcRenderer.invoke("setup:state"),
    connect: (/** @type {string} */ url) => ipcRenderer.invoke("setup:connect", url),
    cancelSetup: () => ipcRenderer.send("setup:cancel"),
    retry: () => ipcRenderer.send("offline:retry"),
    changeServer: () => ipcRenderer.send("offline:change-server"),
    pickerSources: () => ipcRenderer.invoke("picker:sources"),
    pick: (/** @type {string | null} */ id) => ipcRenderer.send("picker:choose", id),
  });
} else {
  contextBridge.exposeInMainWorld("worklioDesktop", {
    platform: process.platform,
    /** Bring the app window to the front (a notification was clicked). */
    focus: () => ipcRenderer.send("worklio:focus"),
    /** Annotations on a screen I share, drawn over my real screen (see annotation-overlay.js). */
    annotations: {
      start: (/** @type {{ width: number, height: number }} */ info) =>
        ipcRenderer.send("annotate:start", { width: Number(info?.width) || 0, height: Number(info?.height) || 0 }),
      op: (/** @type {unknown} */ op) => ipcRenderer.send("annotate:op", op),
      stop: () => ipcRenderer.send("annotate:stop"),
      onOp: (/** @type {(op: unknown) => void} */ fn) => {
        const listener = (/** @type {unknown} */ _e, /** @type {unknown} */ op) => fn(op);
        ipcRenderer.on("annotate:op", listener);
        return () => {
          ipcRenderer.removeListener("annotate:op", listener);
        };
      },
    },
  });
}
