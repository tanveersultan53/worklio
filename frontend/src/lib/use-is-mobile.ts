import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";

function subscribe(fn: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}

/** Phone-sized screen (below Tailwind's `md`). False during SSR. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
