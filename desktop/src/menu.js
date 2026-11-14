// @ts-check
"use strict";

/** The application menu. Mostly standard roles plus "Change server…" and back/forward. */
const { Menu, app, shell } = require("electron");

const REPO = "https://github.com/tanveersultan53/worklio";

/**
 * @param {{ showSetup: () => void, getWindow: () => Electron.BrowserWindow | null }} opts
 */
function buildMenu({ showSetup, getWindow }) {
  const mac = process.platform === "darwin";
  const history = () => getWindow()?.webContents.navigationHistory;

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(mac
      ? [
          /** @type {Electron.MenuItemConstructorOptions} */ ({
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { label: "Change server…", click: showSetup },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          }),
        ]
      : [
          /** @type {Electron.MenuItemConstructorOptions} */ ({
            label: "&File",
            submenu: [{ label: "Change server…", click: showSetup }, { type: "separator" }, { role: "quit" }],
          }),
        ]),
    { role: "editMenu" },
    {
      label: mac ? "View" : "&View",
      submenu: [
        { label: "Back", accelerator: "CmdOrCtrl+[", click: () => history()?.canGoBack() && history()?.goBack() },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => history()?.canGoForward() && history()?.goForward(),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Worklio on GitHub", click: () => void shell.openExternal(REPO) },
        { label: "Report a problem", click: () => void shell.openExternal(`${REPO}/issues/new/choose`) },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
