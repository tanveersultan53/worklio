"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Slack-style tooltips for every icon-only control, without wrapping each one.
 *
 * Hover (after a short delay) or keyboard focus on a button / link / [role=button] that has an
 * `aria-label` or `title` but little or no visible text shows a small dark label above it (below
 * when there's no room). `aria-keyshortcuts` is shown as a key hint. Native `title` tooltips are
 * suppressed while ours is up so there aren't two. Controls that already use the Tooltip
 * component, text buttons, and touch screens are left alone. Mount once.
 */
const SELECTOR = "button, a[href], [role=button], [role=tab], [role=radio], [role=menuitem]";
const SHOW_DELAY_MS = 350;
/** Moving between controls within this long after one hides shows the next immediately. */
const WARM_MS = 600;

type Tip = { text: string; keys: string; x: number; y: number; below: boolean };

function labelFor(el: HTMLElement): string {
  if (el.closest("[data-slot=tooltip-trigger], [data-no-auto-tip]")) return "";
  const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.dataset.autoTitle || "").trim();
  if (!label) return "";
  const visible = (el.innerText || "").replace(/\s+/g, " ").trim();
  // Text buttons already say what they do; only label icon-ish ones (or numbers like "3").
  if (visible && visible.length > 3 && !label.toLowerCase().startsWith(visible.toLowerCase())) return label;
  if (visible.length > 3) return "";
  return label;
}

export function AutoTooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHide = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;

    const restoreTitle = (el: HTMLElement | null) => {
      if (el?.dataset.autoTitle) {
        el.setAttribute("title", el.dataset.autoTitle);
        delete el.dataset.autoTitle;
      }
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      restoreTitle(current.current);
      if (current.current) lastHide.current = Date.now();
      current.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = labelFor(el);
      if (!text) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const title = el.getAttribute("title");
      if (title) {
        el.dataset.autoTitle = title;
        el.removeAttribute("title");
      }
      const below = r.top < 44;
      setTip({
        text,
        keys: el.getAttribute("aria-keyshortcuts") ?? "",
        // Keep the label on screen near the edges (it's centred on x).
        x: Math.min(Math.max(r.left + r.width / 2, 72), window.innerWidth - 72),
        y: below ? r.bottom + 6 : r.top - 6,
        below,
      });
    };
    const arm = (el: HTMLElement, immediate: boolean) => {
      if (current.current === el) return;
      hide();
      current.current = el;
      const warm = Date.now() - lastHide.current < WARM_MS;
      timer.current = window.setTimeout(() => current.current === el && show(el), immediate || warm ? 0 : SHOW_DELAY_MS);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (!el) {
        if (current.current) hide();
        return;
      }
      arm(el, false);
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.matches?.(SELECTOR) && el.matches(":focus-visible")) arm(el, true);
    };
    const onOut = (e: PointerEvent) => {
      const to = e.relatedTarget as Node | null;
      if (current.current && (!to || !current.current.contains(to))) hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] w-max max-w-64 rounded-md bg-zinc-900 px-2 py-1 text-center text-xs leading-snug font-semibold text-white shadow-lg animate-in fade-in-0 duration-100 dark:bg-zinc-100 dark:text-zinc-900"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
      {tip.keys && <span className="ml-1.5 font-normal opacity-70">{tip.keys}</span>}
    </div>,
    document.body,
  );
}
