// @ts-check
export {};

/** @type {any} */
const bridge = /** @type {any} */ (window).shell;
const detail = new URLSearchParams(location.search).get("error");
const detailEl = /** @type {HTMLElement} */ (document.getElementById("detail"));
if (detail) detailEl.textContent = `Error: ${detail}`;
document.getElementById("retry")?.addEventListener("click", () => bridge.retry());
document.getElementById("change")?.addEventListener("click", () => bridge.changeServer());
// Come back by itself as soon as the network does.
window.addEventListener("online", () => bridge.retry());
