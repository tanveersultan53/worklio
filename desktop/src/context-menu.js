// @ts-check
"use strict";

/** Right-click menu: spelling fixes, copy/paste, links and images. */
const { Menu, clipboard } = require("electron");

/**
 * @param {Electron.WebContents} wc
 * @param {{ openExternal: (url: string) => void, isDev: boolean }} opts
 */
function attachContextMenu(wc, { openExternal, isDev }) {
  wc.on("context-menu", (_event, params) => {
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const items = [];
    const sep = () => items.length && items[items.length - 1].type !== "separator" && items.push({ type: "separator" });

    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => wc.replaceMisspelling(word) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: "No suggestions", enabled: false });
      items.push({
        label: "Add to dictionary",
        click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      sep();
    }

    if (params.linkURL && /^(https?|mailto):/.test(params.linkURL)) {
      items.push({ label: "Open link in browser", click: () => openExternal(params.linkURL) });
      items.push({
        label: params.linkURL.startsWith("mailto:") ? "Copy email address" : "Copy link",
        click: () => clipboard.writeText(params.linkURL.replace(/^mailto:/, "")),
      });
      sep();
    }

    if (params.mediaType === "image" && params.srcURL) {
      items.push({ label: "Copy image", click: () => wc.copyImageAt(params.x, params.y) });
      items.push({ label: "Save image as…", click: () => wc.downloadURL(params.srcURL) });
      sep();
    }

    const { canCut, canCopy, canPaste, canSelectAll } = params.editFlags;
    if (params.isEditable) {
      items.push({ role: "cut", enabled: canCut });
      items.push({ role: "copy", enabled: canCopy });
      items.push({ role: "paste", enabled: canPaste });
      items.push({ role: "pasteAndMatchStyle", enabled: canPaste });
      items.push({ role: "selectAll", enabled: canSelectAll });
    } else if (params.selectionText.trim()) {
      items.push({ role: "copy", enabled: canCopy });
    }

    if (isDev) {
      sep();
      items.push({ label: "Inspect element", click: () => wc.inspectElement(params.x, params.y) });
    }

    while (items.length && items[items.length - 1].type === "separator") items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
}

module.exports = { attachContextMenu };
