// @ts-check
"use strict";

/** Windows/Linux tray icon: the way back to the window after closing it. Shows a dot when unread. */
const { Menu, Tray, nativeImage } = require("electron");
const path = require("node:path");

/**
 * @param {{ assets: string, show: () => void, quit: () => void }} opts
 */
function createTray({ assets, show, quit }) {
  // tray.png + tray@2x.png: Electron picks the sharp one on high-DPI screens.
  const plain = nativeImage.createFromPath(path.join(assets, "tray.png"));
  const unread = nativeImage.createFromPath(path.join(assets, "tray-unread.png"));
  const tray = new Tray(plain);
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
      tray.setImage(count ? unread : plain);
      tray.setToolTip(count ? `Worklio: ${count} unread` : "Worklio");
    },
  };
}

module.exports = { createTray };
