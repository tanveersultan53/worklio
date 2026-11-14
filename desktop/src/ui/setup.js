// @ts-check
export {};

/** @type {any} */
const bridge = /** @type {any} */ (window).shell;
const form = /** @type {HTMLFormElement} */ (document.getElementById("form"));
const input = /** @type {HTMLInputElement} */ (document.getElementById("url"));
const error = /** @type {HTMLElement} */ (document.getElementById("error"));
const connect = /** @type {HTMLButtonElement} */ (document.getElementById("connect"));
const cancel = /** @type {HTMLButtonElement} */ (document.getElementById("cancel"));

void bridge.setupState().then((/** @type {{ current: string } | null} */ state) => {
  if (state?.current) {
    input.value = state.current;
    cancel.hidden = false;
  }
  input.focus();
  input.select();
});

cancel.addEventListener("click", () => bridge.cancelSetup());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  if (!input.value.trim()) {
    error.textContent = "Enter your server’s address.";
    input.focus();
    return;
  }
  connect.disabled = true;
  connect.textContent = "Connecting…";
  const result = await bridge.connect(input.value);
  if (!result?.ok) {
    error.textContent = result?.error ?? "Couldn’t connect.";
    connect.disabled = false;
    connect.textContent = "Connect";
    input.focus();
  }
});
