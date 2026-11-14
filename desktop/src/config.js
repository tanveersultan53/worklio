// @ts-check
"use strict";

/**
 * Tiny settings store: one JSON file in the app's user-data folder.
 * Holds the server address and the last window position.
 */
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {{ x?: number, y?: number, width: number, height: number, maximized?: boolean }} WindowState
 * @typedef {{ serverUrl?: string, window?: WindowState }} Config
 */

/** @type {Config | null} */
let cache = null;

const file = () => path.join(app.getPath("userData"), "config.json");

/** @returns {Config} */
function get() {
  if (!cache) {
    try {
      const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
      cache = raw && typeof raw === "object" ? raw : {};
    } catch {
      cache = {};
    }
  }
  return /** @type {Config} */ (cache);
}

/** @param {Partial<Config>} patch */
function set(patch) {
  cache = { ...get(), ...patch };
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, target);
}

module.exports = { get, set };
