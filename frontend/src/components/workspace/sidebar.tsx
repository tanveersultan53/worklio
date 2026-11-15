"use client";

import {
  BellRing,
  Check,
  ChevronDown,
  EyeOff,
  Hash,
  Info,
  LayoutGrid,
  MoreHorizontal,
  PanelLeft,
  Palette,
  Plus,
  Settings,
  Settings2,
  SlidersHorizontal,
  UserPlus,
  X,
  SquarePen,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { QuickInviteDialog } from "@/components/admin/quick-invite-dialog";
import { useAppearance } from "@/components/appearance-provider";
import { initials } from "@/components/chat/user-avatar";
import { HuddleDock } from "@/components/huddle";
import { setPreferencesSection } from "@/components/preferences/preferences-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, type NavItem } from "@/components/views/nav-items";
import { useDraftList } from "@/components/views/draft-list";
import { useWorkspaceSettings, viewerCan } from "@/lib/admin";
import { type User } from "@/lib/api";
import {
  adjustLaterCount,
  BADGES_CHANGED_EVENT,
  LATER_CHANGED_EVENT,
  refreshLaterCount,
  useLaterCount,
  type LaterChangedDetail,
} from "@/lib/productivity";
import {
  loadNavBadges,
  loadSidebar,
  setDndUntilLocal,
  switcherVisible,
  toggledSwitcher,
  useNavBadges,
  useNotificationPermission,
  requestNotificationPermission,
  useSidebarState,
  useWorkspaceUnreads,
  type WithDnd,
} from "@/lib/sidebar";
import { cn } from "@/lib/utils";

import { BrowseChannelsDialog, NewChannelDialog, NewDMDialog } from "./dialogs";
import { DndButton, DndPill } from "./notification-prefs";
import { useWorkspace, useWorkspaceEvents } from "./provider";
import type { SidebarView } from "./rail";
import { RowContextMenu, SidebarSections } from "./sidebar-sections";

type DialogName = "channel" | "dm" | "invite" | "browse" | null;

/* ------------------------------------------------------- hidden sidebar */

/**
 * Desktop "hide sidebar" (⌘.): there's no Preferences field for it, so it's remembered per browser.
 * Reads and writes are guarded: private mode / blocked storage just means it isn't remembered.
 */
const HIDDEN_KEY = "worklio.sidebarHidden";
const hiddenListeners = new Set<() => void>();
let hiddenMemo: boolean | null = null;

function readHidden(): boolean {
  if (hiddenMemo !== null) return hiddenMemo;
  try {
    hiddenMemo = localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    hiddenMemo = false;
  }
  return hiddenMemo;
}

export function setSidebarHidden(next: boolean | ((hidden: boolean) => boolean)): void {
  const value = typeof next === "function" ? next(readHidden()) : next;
  if (value === readHidden()) return;
  hiddenMemo = value;
  try {
    if (value) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // not remembered across reloads, still works for this session
  }
  hiddenListeners.forEach((fn) => fn());
}

function subscribeHidden(fn: () => void) {
  hiddenListeners.add(fn);
  // Keep other tabs in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== HIDDEN_KEY) return;
    hiddenMemo = e.newValue === "1";
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    hiddenListeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether the desktop sidebar is hidden (false during SSR / first paint). */
export function useSidebarHidden(): boolean {
  return useSyncExternalStore(subscribeHidden, readHidden, () => false);
}

/** Event types the badges care about (not all of them are in the RealtimeEvent union yet). */
const BADGE_EVENTS = new Set(["activity.new", "activity.read", "thread.updated", "reminder.due", "later.updated", "resync"]);

/**
 * Mount once (in the workspace shell): loads channel prefs + sections, keeps nav badges fresh and mirrors
 * the user's DND into the notification gate.
 */
export function useSidebarSync() {
  const ws = useWorkspace();
  const { workspaceId } = ws;
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dndUntil = (ws.me as (User & WithDnd) | null)?.dnd_until ?? null;

  useEffect(() => {
    loadSidebar(workspaceId);
  }, [workspaceId]);

  useEffect(() => {
    setDndUntilLocal(dndUntil);
  }, [dndUntil]);

  // Badges: on workspace / route change (visiting a view usually marks it read), with a small debounce.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => loadNavBadges(workspaceId), 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [workspaceId, pathname]);

  useEffect(() => {
    const onFocus = () => {
      loadNavBadges(workspaceId);
      refreshLaterCount(workspaceId);
    };
    const onVisible = () => document.visibilityState === "visible" && refreshLaterCount(workspaceId);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId]);

  // Later badge: counted on its own so it moves the instant an item is added, completed, archived or deleted.
  const laterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    refreshLaterCount(workspaceId);
    const recount = (delay: number) => {
      if (laterTimer.current) clearTimeout(laterTimer.current);
      laterTimer.current = setTimeout(() => refreshLaterCount(workspaceId), delay);
    };
    const onChanged = (e: Event) => {
      const d = ((e as CustomEvent<LaterChangedDetail>).detail ?? {}) as LaterChangedDetail;
      if (d.workspaceId && d.workspaceId !== workspaceId) return;
      if (d.delta) adjustLaterCount(workspaceId, d.delta);
      if (d.refetch !== false) recount(120);
    };
    const onBadges = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => loadNavBadges(workspaceId), 150);
    };
    window.addEventListener(LATER_CHANGED_EVENT, onChanged);
    window.addEventListener(BADGES_CHANGED_EVENT, onBadges);
    return () => {
      window.removeEventListener(LATER_CHANGED_EVENT, onChanged);
      window.removeEventListener(BADGES_CHANGED_EVENT, onBadges);
      if (laterTimer.current) clearTimeout(laterTimer.current);
    };
  }, [workspaceId]);

  useWorkspaceEvents((e) => {
    const type = (e as { type: string }).type;
    if (type === "later.updated" || type === "later.deleted" || type === "resync") {
      if (laterTimer.current) clearTimeout(laterTimer.current);
      laterTimer.current = setTimeout(() => refreshLaterCount(workspaceId), 120);
    }
    if (type === "resync") loadSidebar(workspaceId);
    if (!BADGE_EVENTS.has(type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => loadNavBadges(workspaceId), 800);
  });
}

export function Sidebar({ view }: { view: SidebarView }) {
  const ws = useWorkspace();
  const router = useRouter();
  const { prefs, update } = useAppearance();
  const [dialog, setDialog] = useState<DialogName>(null);
  const close = (open: boolean) => !open && setDialog(null);
  const unreads = useWorkspaceUnreads();

  const openPrefs = (section: Parameters<typeof setPreferencesSection>[0]) => {
    setPreferencesSection(section);
    ws.setSidebarOpen(false);
    ws.setPreferencesOpen(true);
  };
  const switcherShown = switcherVisible(prefs.show_workspace_switcher, ws.workspaces.length);
  const others = ws.workspaces.filter((w) => w.id !== ws.workspaceId);
  const { settings: wsSettings } = useWorkspaceSettings(ws.workspaceId);
  const myRole = ws.me ? ws.memberById[ws.me.id]?.role : undefined;
  const canInvite = viewerCan(wsSettings, "invite_members", myRole);
  const title = view === "dms" ? "Direct messages" : (ws.workspace?.name ?? "…");

  return (
    <div className="flex h-full flex-col bg-side text-side-foreground">
      <div className="flex h-12 shrink-0 items-center gap-1 px-2">
        <DropdownMenu>
          {/* Full name on hover/focus, only when it could be cut off. */}
          <Tooltip disabled={title.length <= 12}>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  aria-label={`${title} — workspace menu`}
                  className="group/ws flex h-9 min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left font-black tracking-[-0.01em] text-side-strong outline-none hover:bg-side-hover focus-visible:ring-2 focus-visible:ring-ring/60 data-popup-open:bg-side-hover"
                />
              }
            >
              <span
                className={cn(
                  "min-w-0 truncate leading-tight",
                  // Long names step down a size before they ever need an ellipsis.
                  title.length > 22 ? "text-[15px]" : title.length > 16 ? "text-base" : "text-lg",
                )}
              >
                {title}
              </span>
              <ChevronDown
                aria-hidden
                className="size-3.5 shrink-0 opacity-70 transition-transform duration-150 group-data-popup-open/ws:rotate-180 motion-reduce:transition-none"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" sideOffset={6}>
              {title}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent className="w-72">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-side-active text-sm font-black text-side-active-foreground">
                {initials(ws.workspace?.name ?? "?")}
              </span>
              <div className="min-w-0">
                <div className="truncate font-bold">{ws.workspace?.name}</div>
                <div className="truncate text-xs text-muted-foreground">worklio.app/{ws.workspace?.slug}</div>
              </div>
            </div>
            <DropdownMenuSeparator />
            {canInvite && (
              <DropdownMenuItem onClick={() => setDialog("invite")}>
                <UserPlus className="size-4" /> Invite people to {ws.workspace?.name}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                ws.setSidebarOpen(false);
                router.push(`/w/${ws.workspaceId}/settings`);
              }}
            >
              {ws.isAdmin ? <Settings className="size-4" /> : <Info className="size-4" />}
              {ws.isAdmin ? "Workspace settings" : "About this workspace"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("channel")}>
              <Plus className="size-4" /> Create a channel
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialog("browse")}>
              <Hash className="size-4" /> Browse channels
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openPrefs("appearance")}>
              <Palette className="size-4" /> Preferences
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPrefs("sidebar")}>
              <SlidersHorizontal className="size-4" /> Customize sidebar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => update({ show_workspace_switcher: toggledSwitcher(prefs.show_workspace_switcher, ws.workspaces.length) })}>
              <PanelLeft className="size-4" /> {switcherShown ? "Hide" : "Show"} workspace switcher
              <DropdownMenuShortcut>⌘⇧S</DropdownMenuShortcut>
            </DropdownMenuItem>
            {!switcherShown && others.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                  {ws.workspaces.map((w, i) => {
                    const current = w.id === ws.workspaceId;
                    const count = unreads[w.id]?.count ?? 0;
                    return (
                      <DropdownMenuItem
                        key={w.id}
                        onClick={() => {
                          ws.setSidebarOpen(false);
                          if (!current) router.push(`/w/${w.id}`);
                        }}
                      >
                        {w.icon_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={w.icon_url} alt="" className="size-6 shrink-0 rounded-md object-cover" />
                        ) : (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-black">
                            {initials(w.name)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{w.name}</span>
                        {current ? (
                          <Check className="size-4" />
                        ) : count > 0 ? (
                          <span className="rounded-full bg-badge px-1.5 text-[10px] leading-4 font-bold text-badge-foreground">
                            {count > 99 ? "99+" : count}
                          </span>
                        ) : i < 9 ? (
                          <DropdownMenuShortcut>⌘{i + 1}</DropdownMenuShortcut>
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                ws.setSidebarOpen(false);
                router.push("/new");
              }}
            >
              <LayoutGrid className="size-4" /> Create a new workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Header actions: one compact cluster so the workspace name keeps the room. */}
        <div role="group" aria-label="Quick actions" className="flex shrink-0 items-center gap-px">
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => setDialog("dm")}
                  aria-label="New message"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-side-foreground outline-none hover:bg-side-hover hover:text-side-strong focus-visible:ring-2 focus-visible:ring-ring/60 md:size-7"
                />
              }
            >
              <SquarePen className="size-[15px]" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              New message
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={() => {
                    ws.setSidebarOpen(false);
                    if (ws.isAdmin) router.push(`/w/${ws.workspaceId}/settings`);
                    else openPrefs("appearance");
                  }}
                  aria-label={ws.isAdmin ? "Workspace settings" : "Preferences"}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-side-foreground outline-none hover:bg-side-hover hover:text-side-strong focus-visible:ring-2 focus-visible:ring-ring/60 md:size-7"
                />
              }
            >
              <Settings className="size-[15px]" aria-hidden />
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {ws.isAdmin ? "Workspace settings" : "Preferences"}
            </TooltipContent>
          </Tooltip>
          <DndButton
            onOpenSchedule={() => openPrefs("notifications")}
            className="size-9 rounded-full md:size-7 [&_svg]:size-[15px]"
          />
        </div>
      </div>
      <DndPill onOpenSchedule={() => openPrefs("notifications")} />

      <nav aria-label="Conversations" className={cn("flex-1 overflow-y-auto px-2 pb-4", prefs.sidebar_compact ? "text-[14px]" : "text-[15px]")}>
        {view === "home" && <NavItems onCustomize={() => openPrefs("sidebar")} />}
        <SidebarSections
          view={view}
          onAddChannels={() => setDialog("browse")}
          onNewMessage={() => setDialog("dm")}
          onInvite={() => setDialog("invite")}
        />
      </nav>

      <HuddleDock className="shrink-0" />
      <NotificationPrompt />

      <NewChannelDialog open={dialog === "channel"} onOpenChange={close} />
      <NewDMDialog open={dialog === "dm"} onOpenChange={close} />
      <QuickInviteDialog open={dialog === "invite"} onOpenChange={close} />
      <BrowseChannelsDialog open={dialog === "browse"} onOpenChange={close} />
    </div>
  );
}

/* ------------------------------------------------------------ nav items */

function NavItems({ onCustomize }: { onCustomize: () => void }) {
  const ws = useWorkspace();
  const { prefs, update } = useAppearance();
  const pathname = usePathname();
  const router = useRouter();
  const server = useNavBadges();
  const sidebar = useSidebarState();
  const draftList = useDraftList();
  const laterLive = useLaterCount(ws.workspaceId);

  const hidden = new Set(prefs.sidebar_hidden_items ?? []);
  const shown = NAV_ITEMS.filter((i) => !hidden.has(i.id));
  const tucked = NAV_ITEMS.filter((i) => hidden.has(i.id));

  const channelIds = new Set(ws.channels.map((c) => c.id));
  const unreadTotal = ws.channels.reduce(
    (n, c) => n + ((c.is_member || c.kind === "dm") && !sidebar.prefs[c.id]?.muted ? c.unread_count : 0),
    0,
  );
  const counts: Partial<Record<NavItem["id"], { n: number; strong: boolean }>> = {
    activity: { n: server.activity, strong: true },
    threads: { n: server.threads, strong: false },
    later: { n: laterLive ?? server.later, strong: false },
    unreads: { n: unreadTotal, strong: false },
    drafts: { n: draftList.filter((d) => channelIds.has(d.channelId)).length, strong: false },
  };

  const hide = (id: string) => update({ sidebar_hidden_items: [...hidden, id].slice(0, 20) });
  const isActive = (item: NavItem) => {
    const href = item.href(ws.workspaceId);
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const rowCls = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2.5",
      prefs.sidebar_compact ? "h-8 md:h-6" : "h-9 md:h-7",
      active ? "bg-side-active text-side-active-foreground" : "hover:bg-side-hover",
    );

  return (
    <div className="mt-1 space-y-px" role="list" aria-label="Views">
      {shown.map((item) => {
        const active = isActive(item);
        const c = counts[item.id];
        const n = c?.n ?? 0;
        return (
          <div role="listitem" key={item.id}>
            <RowContextMenu
              menu={
                <>
                  <DropdownMenuItem onClick={() => hide(item.id)}>
                    <EyeOff className="size-4" /> Hide “{item.label}” from sidebar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCustomize}>
                    <Settings2 className="size-4" /> Customize sidebar…
                  </DropdownMenuItem>
                </>
              }
            >
              <Link
                href={item.href(ws.workspaceId)}
                onClick={() => ws.setSidebarOpen(false)}
                aria-current={active ? "page" : undefined}
                title={item.description}
                className={cn(rowCls(active), n > 0 && !active && (c?.strong || item.id === "unreads") && "font-bold text-side-strong")}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {n > 0 &&
                  (c?.strong ? (
                    <span className="rounded-full bg-badge px-2 text-xs leading-5 font-bold text-badge-foreground">
                      {n > 99 ? "99+" : n}
                    </span>
                  ) : (
                    <span className={cn("text-xs tabular-nums", active ? "opacity-90" : "opacity-70")}>{n > 99 ? "99+" : n}</span>
                  ))}
              </Link>
            </RowContextMenu>
          </div>
        );
      })}
      <div role="listitem">
        <DropdownMenu>
          <DropdownMenuTrigger className={rowCls(false)}>
            <MoreHorizontal className="size-4 shrink-0" />
            <span className="flex-1 text-left">More</span>
            {tucked.some((i) => (counts[i.id]?.n ?? 0) > 0 && counts[i.id]?.strong) && (
              <span className="size-2 rounded-full bg-badge" aria-label="Unread in hidden views" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            {tucked.length > 0 && (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Hidden from your sidebar</DropdownMenuLabel>
                  {tucked.map((item) => {
                    const n = counts[item.id]?.n ?? 0;
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => {
                          ws.setSidebarOpen(false);
                          router.push(item.href(ws.workspaceId));
                        }}
                      >
                        <item.icon className="size-4" />
                        <span className="flex-1">{item.label}</span>
                        {n > 0 && <span className="text-xs text-muted-foreground tabular-nums">{n > 99 ? "99+" : n}</span>}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            {tucked.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Every view is in your sidebar. Right-click one to hide it.</p>
            )}
            <DropdownMenuItem onClick={onCustomize}>
              <Settings2 className="size-4" /> Customize sidebar…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ------------------------------------------------- notification prompt */

/** Offer desktop notifications for DMs and @mentions (browser asks for permission once). */
const PROMPT_DISMISSED_KEY = "worklio.notifyPromptDismissedAt";

function NotificationPrompt() {
  const permission = useNotificationPermission();
  const [dismissed, setDismissed] = useState(false);
  // Remember a dismissal for 30 days in this browser, so the prompt doesn't return on every load.
  const dismissedEarlier = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return Date.now() - Number(localStorage.getItem(PROMPT_DISMISSED_KEY) ?? 0) < 30 * 86_400_000;
      } catch {
        return false;
      }
    },
    () => true,
  );
  if (permission !== "default" || dismissed || dismissedEarlier) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(PROMPT_DISMISSED_KEY, String(Date.now()));
    } catch {}
    setDismissed(true);
  };
  return (
    <div className="m-2 flex items-start gap-2 rounded-lg border bg-background p-3 text-sm text-foreground">
      <BellRing className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">
        <p className="font-bold">Get notified</p>
        <p className="text-xs text-muted-foreground">For direct messages and @mentions.</p>
        <button
          onClick={() => requestNotificationPermission().catch(() => {})}
          className="mt-2 rounded-md bg-send px-2.5 py-1 text-xs font-bold text-white"
        >
          Turn on notifications
        </button>
      </div>
      <button onClick={dismiss} aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}
