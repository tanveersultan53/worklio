// @ts-check
export {};

/** @typedef {{ id: string, name: string, kind: "screen" | "window", thumbnail: string, icon: string }} Source */

/** @type {any} */
const bridge = /** @type {any} */ (window).shell;
const grid = /** @type {HTMLUListElement} */ (document.getElementById("grid"));
const empty = /** @type {HTMLElement} */ (document.getElementById("empty"));
const share = /** @type {HTMLButtonElement} */ (document.getElementById("share"));
const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"]')]);

/** @type {Source[]} */
let sources = [];
let kind = "screen";
/** @type {string | null} */
let selected = null;

function render() {
  grid.textContent = "";
  const shown = sources.filter((s) => s.kind === kind);
  empty.hidden = shown.length > 0;
  empty.textContent = kind === "screen" ? "No screens available." : "No windows to share.";
  for (const s of shown) {
    const li = document.createElement("li");
    li.className = "source";
    li.role = "option";
    li.tabIndex = 0;
    li.setAttribute("aria-selected", String(s.id === selected));
    li.dataset.id = s.id;

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.alt = "";
    if (s.thumbnail) thumb.src = s.thumbnail;
    li.append(thumb);

    const name = document.createElement("div");
    name.className = "name";
    if (s.icon) {
      const icon = document.createElement("img");
      icon.src = s.icon;
      icon.alt = "";
      name.append(icon);
    }
    const label = document.createElement("span");
    label.textContent = s.name;
    label.title = s.name;
    name.append(label);
    li.append(name);

    li.addEventListener("click", () => select(s.id));
    li.addEventListener("dblclick", () => bridge.pick(s.id));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (selected === s.id) bridge.pick(s.id);
        else select(s.id);
      }
    });
    grid.append(li);
  }
}

/** @param {string} id */
function select(id) {
  selected = id;
  share.disabled = false;
  for (const li of grid.children) li.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (li).dataset.id === id));
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    kind = tab.dataset.kind ?? "screen";
    for (const t of tabs) t.setAttribute("aria-selected", String(t === tab));
    render();
  });
}

share.addEventListener("click", () => selected && bridge.pick(selected));
document.getElementById("cancel")?.addEventListener("click", () => bridge.pick(null));
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") bridge.pick(null);
});

void bridge.pickerSources().then((/** @type {Source[]} */ list) => {
  sources = list;
  const screens = list.filter((s) => s.kind === "screen");
  // One screen? Preselect it so sharing is one click.
  if (screens.length === 1) {
    selected = screens[0].id;
    share.disabled = false;
  }
  render();
});
