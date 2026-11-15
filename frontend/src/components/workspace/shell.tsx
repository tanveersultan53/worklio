"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AskWorklioPanel } from "@/components/ai/ask-worklio";
import { useAppearance } from "@/components/appearance-provider";
import { CallProvider } from "@/components/calls";
import { ConnectionBanner } from "@/components/chat/connection-banner";
import { Toaster } from "@/components/chat/toaster";
import { HuddleBar, HuddleProvider } from "@/components/huddle";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { ProfileDialog } from "@/components/workspace/profile-dialog";
import { sidebarFlatOrder, toggledSwitcher } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

import { AutoTooltips } from "@/components/ui/auto-tooltips";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

import { useWorkspace, WorkspaceProvider } from "./provider";
import { QuickSwitcher } from "./quick-switcher";
import { Rail, type SidebarView } from "./rail";
import { setSidebarHidden, Sidebar, useSidebarHidden, useSidebarSync } from "./sidebar";
import { TopBar } from "./top-bar";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <HuddleProvider>
        <CallProvider>
          <Layout>{children}</Layout>
        </CallProvider>
      </HuddleProvider>
    </WorkspaceProvider>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const ws = useWorkspace();
  const {
    sidebarOpen,
    setSidebarOpen,
    setSwitcherOpen,
    preferencesOpen,
    setPreferencesOpen,
    setFocusMode,
    connection,
  } = ws;
  // "Focus mode" (⌘.) is the hidden-sidebar state: rail + sidebar collapse, content takes the width.
  const focusMode = useSidebarHidden();
  const router = useRouter();
  const [view, setView] = useState<SidebarView>("home");
  const appearance = useAppearance();
  const { update: updatePrefs } = appearance;
  useSidebarSync();

  // Latest workspace + appearance state for the keydown handler, without re-binding it on every render.
  const wsRef = useRef(ws);
  const prefsRef = useRef(appearance.prefs);
  useEffect(() => {
    wsRef.current = ws;
    prefsRef.current = appearance.prefs;
  });

  // Global shortcuts: ⌘K switcher, ⌘, preferences, ⌘. focus mode,
  // ⌥↑/↓ previous/next conversation, ⌥⇧↑/↓ previous/next unread, Esc marks the open conversation read.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = wsRef.current;
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        const order = sidebarFlatOrder(cur.channels, cur.channelLabel);
        if (!order.length) return;
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        const from = order.findIndex((c) => c.id === cur.activeChannelId);
        let target: (typeof order)[number] | undefined;
        if (e.shiftKey) {
          // Walk the whole list once (wrapping), stopping at the first unread conversation.
          for (let i = 1; i <= order.length; i++) {
            const c = order[(((from + step * i) % order.length) + order.length) % order.length];
            if (c.unread_count > 0 && c.id !== cur.activeChannelId) {
              target = c;
              break;
            }
          }
        } else {
          const next = from === -1 ? (step === 1 ? 0 : order.length - 1) : from + step;
          target = order[next];
        }
        if (target) router.push(`/w/${cur.workspaceId}/c/${target.id}`);
        return;
      }
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented) {
        const el = e.target as HTMLElement | null;
        const typing = el?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
        // Don't steal Esc from open dialogs, menus and popovers.
        const overlay = document.querySelector(
          "[data-slot=dialog-content], [data-slot=sheet-content], [data-slot=popover-content], [data-slot=dropdown-menu-content], [role=dialog], [role=menu], [role=listbox]",
        );
        if (!typing && !overlay && cur.activeChannelId) cur.markRead(cur.activeChannelId);
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      // ⌘⇧S: show / hide the workspace switcher.
      if (e.shiftKey && !e.altKey && (key === "s" || e.code === "KeyS")) {
        e.preventDefault();
        updatePrefs({ show_workspace_switcher: toggledSwitcher(prefsRef.current.show_workspace_switcher, cur.workspaces.length) });
        return;
      }
      // ⌘1–9: jump to the nth workspace (browsers may reserve these for tabs; Ctrl works on Windows/Linux).
      if (!e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const target = cur.workspaces[Number(e.code.slice(5)) - 1];
        if (!target) return;
        e.preventDefault();
        if (target.id !== cur.workspaceId) router.push(`/w/${target.id}`);
        return;
      }
      if (key === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (key === ",") {
        e.preventDefault();
        setPreferencesOpen(true);
      } else if (key === ".") {
        e.preventDefault();
        setSidebarHidden((h) => {
          setFocusMode(!h);
          return !h;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSwitcherOpen, setPreferencesOpen, setFocusMode, router, updatePrefs]);

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden overscroll-none bg-chrome pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      style={{ backgroundImage: "var(--chrome-gradient)" }}
    >
      <TopBar />
      <ConnectionBanner status={connection} />
      <div className="flex min-h-0 flex-1">
        <div className={cn("hidden md:flex", focusMode && "md:hidden")}>
          <Rail view={view} onView={setView} />
        </div>
        <div
          className={cn(
            "flex min-w-0 flex-1 overflow-hidden md:mb-1.5 md:rounded-xl md:shadow-lg",
            focusMode ? "md:mx-1.5" : "md:mr-1.5",
          )}
        >
          {!focusMode && (
            <aside
              className="group/aside relative hidden shrink-0 md:block md:max-w-[34vw] lg:max-w-none"
              style={{ width: "var(--sidebar-width, 260px)" }}
            >
              <Sidebar view={view} />
              <ResizeHandle />
            </aside>
          )}
          <main className="relative flex min-w-0 flex-1 bg-background">
            {children}
            {focusMode && <SidebarPeek view={view} onView={setView} />}
          </main>
        </div>
      </div>

      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="gap-0 border-0 bg-chrome p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] data-[side=left]:w-[min(370px,92vw)] data-[side=left]:border-r-0 data-[side=left]:sm:max-w-[370px]"
          style={{ backgroundImage: "var(--chrome-gradient)" }}
          showCloseButton={false}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-full min-h-0 pt-2">
            <Rail view={view} onView={setView} />
            <div className="min-w-0 flex-1 overflow-hidden rounded-tl-xl">
              <Sidebar view={view} />
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <QuickSwitcher />
      <PreferencesDialog open={preferencesOpen} onOpenChange={setPreferencesOpen} />
      <ProfileDialog />
      <HuddleBar />
      <AskWorklioPanel />
      <Toaster />
      <AutoTooltips />
    </div>
  );
}

const POPUP_OPEN =
  "[data-slot=dropdown-menu-content], [data-slot=popover-content], [data-slot=dialog-content], [data-slot=context-menu-content], [role=menu], [role=dialog], [role=listbox]";

/**
 * While the sidebar is hidden: resting the pointer on the left edge for 300 ms slides the rail + sidebar in
 * over the content; leaving it slides it away (unless a menu or dialog opened from it is still up).
 * Navigating closes it. Desktop pointers only; phones keep the drawer.
 */
function SidebarPeek({ view, onView }: { view: SidebarView; onView: (v: SidebarView) => void }) {
  const pathname = usePathname();
  // Open for the path it was opened on: following a link inside it closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inside = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  const clear = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    openTimer.current = closeTimer.current = null;
  };
  useEffect(() => clear, []);

  const scheduleClose = (delay = 220) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(function check() {
      const focusInside = !!panel.current?.contains(document.activeElement);
      // Keep it while the pointer is back inside, focus is in it, or one of its menus/dialogs is open.
      if (inside.current || focusInside || document.querySelector(POPUP_OPEN)) {
        closeTimer.current = setTimeout(check, 400);
        return;
      }
      closeTimer.current = null;
      setOpenOn(null);
    }, delay);
  };

  return (
    <>
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 z-30 hidden w-2 md:block [@media(hover:none)]:hidden"
        onPointerEnter={(e) => {
          if (e.pointerType === "touch") return;
          clear();
          const path = pathname;
          openTimer.current = setTimeout(() => setOpenOn(path), 300);
        }}
        onPointerLeave={() => {
          if (openTimer.current) clearTimeout(openTimer.current);
          openTimer.current = null;
        }}
      />
      <div
        ref={panel}
        role="region"
        aria-label="Sidebar"
        inert={!open}
        data-open={open || undefined}
        onPointerEnter={() => {
          inside.current = true;
          if (closeTimer.current) clearTimeout(closeTimer.current);
          closeTimer.current = null;
        }}
        onPointerLeave={() => {
          inside.current = false;
          if (open) scheduleClose();
        }}
        onBlur={(e) => {
          if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) scheduleClose(120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(POPUP_OPEN)) {
            clear();
            setOpenOn(null);
          }
        }}
        className="absolute inset-y-0 left-0 z-40 hidden max-w-[calc(100%-2rem)] -translate-x-[calc(100%+12px)] overflow-hidden rounded-r-xl bg-chrome opacity-0 shadow-2xl ring-1 ring-black/10 transition-[translate,opacity] duration-200 ease-out data-open:translate-x-0 data-open:opacity-100 md:flex motion-reduce:transition-none dark:ring-white/10"
        style={{ backgroundImage: "var(--chrome-gradient)" }}
      >
        <div className="flex h-full min-h-0 pt-1.5">
          <Rail view={view} onView={onView} />
          <div className="min-w-0 overflow-hidden rounded-tl-xl" style={{ width: "var(--sidebar-width, 260px)" }}>
            <Sidebar view={view} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Drag the sidebar's edge to resize it (200–440px); double-click to reset. Saved to preferences. */
function ResizeHandle() {
  const { prefs, update } = useAppearance();
  const dragging = useRef(false);

  const widthAt = (clientX: number, el: HTMLElement) => {
    const left = el.parentElement!.getBoundingClientRect().left;
    return Math.round(Math.min(440, Math.max(200, clientX - left)));
  };

  /** End a drag that was interrupted (pointercancel, lost capture): restore selection and the saved width. */
  const abort = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.userSelect = "";
    document.documentElement.style.setProperty("--sidebar-width", `${prefs.sidebar_width}px`);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={prefs.sidebar_width}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none [@media(pointer:coarse)]:-right-2 [@media(pointer:coarse)]:w-4"
      onDoubleClick={() => update({ sidebar_width: 260 })}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        document.documentElement.style.setProperty("--sidebar-width", `${widthAt(e.clientX, e.currentTarget)}px`);
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        document.body.style.userSelect = "";
        update({ sidebar_width: widthAt(e.clientX, e.currentTarget) });
      }}
      onPointerCancel={abort}
      onLostPointerCapture={abort}
    >
      <div className="mx-auto h-full w-0.5 bg-transparent transition group-hover:bg-side-active" />
    </div>
  );
}
