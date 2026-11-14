// @ts-check
"use strict";

/** Windows/Linux tray icon: the way back to the window after closing it. */
const { Menu, Tray, nativeImage } = require("electron");

/**
 * @param {{ icon: string, show: () => void, quit: () => void }} opts
 */
function createTray({ icon, show, quit }) {
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16, quality: "best" });
  const tray = new Tray(image);
  tray.setToolTip("Worklio");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Worklio", click: show },
      { type: "separator" },
      { label: "Quit Worklio", click: quit },
    ]),
  );
  tray.on("click", show);
  return {
    /** @param {number} count */
    setUnread(count) {
      tray.setToolTip(count ? `Worklio — ${count} unread` : "Worklio");
    },
  };
}

module.exports = { createTray };
