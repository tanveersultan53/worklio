// @ts-check
"use strict";

/** Turning what someone typed into a Worklio server origin, and checking it answers. */
const { net } = require("electron");

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local|[^.]+)(:\d+)?$/i;

/**
 * "chat.acme.com" → "https://chat.acme.com"; "192.168.1.5:3000" → "http://192.168.1.5:3000".
 * Returns the origin only (Worklio runs at the root of its host), or null if it isn't a web address.
 * @param {string} input
 */
function normalize(input) {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const host = text.split("/")[0];
    text = `${LOCAL_HOST.test(host) ? "http" : "https"}://${text}`;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True for http:// servers that aren't localhost, where the browser blocks mic and camera. */
function needsSecureContextOverride(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Fetch the server's front page and make sure it is Worklio.
 * @param {string} origin
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function probe(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await net.fetch(origin, { signal: controller.signal, redirect: "follow", cache: "no-store" });
    if (res.status >= 500) return { ok: false, error: `The server answered with an error (${res.status}). Try again in a moment.` };
    const body = await res.text();
    if (!/worklio/i.test(body)) return { ok: false, error: "That address answered, but it isn't a Worklio server." };
    return { ok: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? "The server took too long to answer. Check the address and your connection."
        : "Couldn't reach that address. Check it's typed correctly and the server is running.",
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { normalize, probe, needsSecureContextOverride };
