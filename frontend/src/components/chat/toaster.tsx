"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { dismissToast, toastStore } from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS = { error: CircleAlert, success: CircleCheck, info: Info } as const;

/**
 * Renders toasts from lib/toast as small notices at the top centre, above the huddle window, so
 * an error never covers the call controls at the bottom. Mount exactly once (workspace shell).
 */
export function Toaster() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getServerSnapshot);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[160] flex flex-col items-center gap-1.5 px-4"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md animate-in items-center gap-2 rounded-xl border bg-popover py-1.5 pr-1.5 pl-3 text-[13px] leading-snug text-popover-foreground shadow-lg fade-in-0 slide-in-from-top-2"
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                t.kind === "error" ? "text-destructive" : t.kind === "success" ? "text-emerald-600" : "text-link",
              )}
            />
            <span className="min-w-0 flex-1 break-words">{t.message}</span>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
