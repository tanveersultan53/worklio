"use client";

import { useSyncExternalStore } from "react";

import { api, type Channel, type Message, type User } from "@/lib/api";
import { bringToFront } from "@/lib/desktop";
import type { NotifyLevel, NotifySchedule, Preferences } from "@/lib/appearance";
import { errorMessage, toast } from "@/lib/toast";

/**
 * Sidebar customisation + notification rules.
 *
 * - Typed API for per-channel prefs (star / mute / notify level / section), custom sidebar sections and DND.
 * - A small external store (`useSidebarState`) shared by the sidebar, the shell's keyboard navigation and the
 *   notification gate (`shouldNotify`), so every part of the app sees the same optimistic state.
 */

/* ------------------------------------------------------------------ types */

/** Per-channel level; "default" follows the global `desktop_notify` preference. */
export type ChannelNotifyLevel = NotifyLevel | "default";

export type ChannelPref = {
  channel_id: string;
  muted: boolean;
  notify: ChannelNotifyLevel;
  starred: boolean;
  section_id: string | null;
};
export type ChannelPrefPatch = Partial<Omit<ChannelPref, "channel_id">>;

export type SidebarSection = { id: string; name: string; position: number; collapsed: boolean };

/** `User`/`Member` gain `dnd_until` in Wave A (ISO timestamp or null). */
export type WithDnd = { dnd_until?: string | null };

/* ------------------------------------------------------------------ store */

export type SidebarState = {
  workspaceId: string | null;
  loaded: boolean;
  error: boolean;
  prefs: Record<string, ChannelPref>;
  sections: SidebarSection[];
  /** Collapsed state of the built-in sections (starred / channels / dms), kept per device. */
  localCollapsed: Record<string, boolean>;
  /** Latest known DND end for the signed-in user (mirrors `me.dnd_until`). */
  dndUntil: string | null;
};

const INITIAL: SidebarState = {
  workspaceId: null,
  loaded: false,
  error: false,
  prefs: {},
  sections: [],
  localCollapsed: {},
  dndUntil: null,
};

let state: SidebarState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<SidebarState> | ((s: SidebarState) => Partial<SidebarState>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((fn) => fn());
}

export const sidebarStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get: () => state,
  getServerSnapshot: () => INITIAL,
};

/** Current sidebar state (channel prefs, sections, collapse state). Re-renders on change. */
export function useSidebarState(): SidebarState {
  return useSyncExternalStore(sidebarStore.subscribe, sidebarStore.get, sidebarStore.getServerSnapshot);
}

const COLLAPSE_KEY = (ws: string) => `worklio.sidebar.collapsed.${ws}`;

function readLocalCollapsed(ws: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY(ws)) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

const sortSections = (s: SidebarSection[]) => [...s].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

let loadSeq = 0;

/** Load channel prefs + sections for a workspace (resets the store when the workspace changes). */
export async function loadSidebar(workspaceId: string): Promise<void> {
  if (state.workspaceId !== workspaceId) {
    setState({ ...INITIAL, dndUntil: state.dndUntil, workspaceId, localCollapsed: readLocalCollapsed(workspaceId) });
  }
  const seq = ++loadSeq;
  try {
    const [prefs, sections] = await Promise.all([
      api<ChannelPref[]>(`/workspaces/${workspaceId}/channel-prefs`),
      api<SidebarSection[]>(`/workspaces/${workspaceId}/sidebar-sections`),
    ]);
    if (seq !== loadSeq || state.workspaceId !== workspaceId) return;
    setState({
      loaded: true,
      error: false,
      prefs: Object.fromEntries(prefs.map((p) => [p.channel_id, p])),
      sections: sortSections(sections),
    });
  } catch {
    if (seq !== loadSeq || state.workspaceId !== workspaceId) return;
    // The sidebar still works without prefs: everything falls back to the default sections.
    setState({ loaded: true, error: true });
  }
}

export function setDndUntilLocal(until: string | null | undefined) {
  if ((until ?? null) !== state.dndUntil) setState({ dndUntil: until ?? null });
}

export function setLocalCollapsed(key: string, collapsed: boolean) {
  const next = { ...state.localCollapsed, [key]: collapsed };
  setState({ localCollapsed: next });
  try {
    if (state.workspaceId) localStorage.setItem(COLLAPSE_KEY(state.workspaceId), JSON.stringify(next));
  } catch {}
}

export function defaultPref(channelId: string): ChannelPref {
  return { channel_id: channelId, muted: false, notify: "default", starred: false, section_id: null };
}

/* --------------------------------------------------------- channel prefs */

/** Optimistically patch a channel's prefs; rolls back with a toast if the server refuses. */
export async function updateChannelPref(channelId: string, patch: ChannelPrefPatch): Promise<boolean> {
  const before = state.prefs[channelId];
  setState((s) => ({ prefs: { ...s.prefs, [channelId]: { ...(before ?? defaultPref(channelId)), ...patch } } }));
  try {
    const saved = await api<Partial<ChannelPref> | undefined>(`/channels/${channelId}/prefs`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (saved && typeof saved === "object" && "channel_id" in saved) {
      setState((s) => ({ prefs: { ...s.prefs, [channelId]: { ...defaultPref(channelId), ...s.prefs[channelId], ...saved } } }));
    }
    return true;
  } catch (e) {
    setState((s) => {
      const prefs = { ...s.prefs };
      if (before) prefs[channelId] = before;
      else delete prefs[channelId];
      return { prefs };
    });
    toast.error(errorMessage(e, "Couldn't update the conversation settings"));
    return false;
  }
}

/* -------------------------------------------------------------- sections */

export async function createSection(workspaceId: string, name: string): Promise<SidebarSection | null> {
  try {
    const created = await api<SidebarSection>(`/workspaces/${workspaceId}/sidebar-sections`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (state.workspaceId === workspaceId) {
      setState((s) => ({ sections: sortSections([...s.sections.filter((x) => x.id !== created.id), created]) }));
    }
    return created;
  } catch (e) {
    toast.error(errorMessage(e, "Couldn't create the section"));
    return null;
  }
}

export async function updateSection(id: string, patch: Partial<Omit<SidebarSection, "id">>): Promise<boolean> {
  const before = state.sections;
  setState((s) => ({ sections: sortSections(s.sections.map((x) => (x.id === id ? { ...x, ...patch } : x))) }));
  try {
    await api(`/sidebar-sections/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    return true;
  } catch (e) {
    setState({ sections: before });
    toast.error(errorMessage(e, "Couldn't update the section"));
    return false;
  }
}

/** Persist a new order (ids top → bottom); only sections whose position changed are patched. */
export async function reorderSections(orderedIds: string[]): Promise<void> {
  const before = state.sections;
  const byId = Object.fromEntries(before.map((s) => [s.id, s]));
  const next = orderedIds.filter((id) => byId[id]).map((id, i) => ({ ...byId[id], position: i }));
  const changed = next.filter((s) => byId[s.id].position !== s.position);
  if (!changed.length) return;
  setState({ sections: next });
  try {
    await Promise.all(
      changed.map((s) => api(`/sidebar-sections/${s.id}`, { method: "PATCH", body: JSON.stringify({ position: s.position }) })),
    );
  } catch (e) {
    setState({ sections: before });
    toast.error(errorMessage(e, "Couldn't reorder sections"));
  }
}

/** Delete a section; its conversations fall back to Channels / Direct messages. */
export async function deleteSection(id: string): Promise<boolean> {
  const before = { sections: state.sections, prefs: state.prefs };
  setState((s) => ({
    sections: s.sections.filter((x) => x.id !== id),
    prefs: Object.fromEntries(
      Object.entries(s.prefs).map(([k, p]) => [k, p.section_id === id ? { ...p, section_id: null } : p]),
    ),
  }));
  try {
    await api(`/sidebar-sections/${id}`, { method: "DELETE" });
    return true;
  } catch (e) {
    setState(before);
    toast.error(errorMessage(e, "Couldn't delete the section"));
    return false;
  }
}

/* ------------------------------------------------------------- ordering */

export type SidebarGroupKind = "starred" | "custom" | "channels" | "dms";
export type SidebarGroup = {
  /** "starred" | "channels" | "dms" | the custom section id. */
  key: string;
  kind: SidebarGroupKind;
  title: string;
  section?: SidebarSection;
  items: Channel[];
};

/**
 * Every conversation in the order the sidebar shows it: Starred, custom sections, Channels, Direct messages.
 * Channels sort by name; DMs unread first, then by name. Shared with ⌥↑/↓ navigation in the shell.
 */
export function sidebarGroups(all: Channel[], label: (c: Channel) => string, s: SidebarState = state): SidebarGroup[] {
  const visible = all.filter((c) => c.kind === "dm" || c.is_member);
  const sectionIds = new Set(s.sections.map((x) => x.id));
  const byName = (a: Channel, b: Channel) => label(a).localeCompare(label(b));
  const dmSort = (a: Channel, b: Channel) => b.unread_count - a.unread_count || byName(a, b);
  const sortMixed = (list: Channel[]) =>
    [...list].sort((a, b) => Number(a.kind === "dm") - Number(b.kind === "dm") || (a.kind === "dm" ? dmSort(a, b) : byName(a, b)));

  const starred: Channel[] = [];
  const custom: Record<string, Channel[]> = {};
  const channels: Channel[] = [];
  const dms: Channel[] = [];
  for (const c of visible) {
    const p = s.prefs[c.id];
    if (p?.starred) starred.push(c);
    else if (p?.section_id && sectionIds.has(p.section_id)) (custom[p.section_id] ??= []).push(c);
    else if (c.kind === "dm") dms.push(c);
    else channels.push(c);
  }

  const groups: SidebarGroup[] = [];
  if (starred.length) groups.push({ key: "starred", kind: "starred", title: "Starred", items: sortMixed(starred) });
  for (const sec of s.sections) {
    groups.push({ key: sec.id, kind: "custom", title: sec.name, section: sec, items: sortMixed(custom[sec.id] ?? []) });
  }
  groups.push({ key: "channels", kind: "channels", title: "Channels", items: [...channels].sort(byName) });
  groups.push({ key: "dms", kind: "dms", title: "Direct messages", items: [...dms].sort(dmSort) });
  return groups;
}

/** Flat sidebar order (for keyboard navigation). */
export function sidebarFlatOrder(all: Channel[], label: (c: Channel) => string): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const g of sidebarGroups(all, label)) {
    for (const c of g.items) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ DND */

/** PUT /auth/me/dnd. `until` null resumes notifications. Returns the updated user. */
export async function putDnd(until: string | null): Promise<User & WithDnd> {
  const u = await api<User & WithDnd>("/auth/me/dnd", { method: "PUT", body: JSON.stringify({ until }) });
  setDndUntilLocal(u.dnd_until ?? null);
  return u;
}

export function dndActive(dndUntil: string | null | undefined, now = Date.now()): boolean {
  return !!dndUntil && new Date(dndUntil).getTime() > now;
}

/** Common pause presets, resolved at click time. */
export function dndPresetUntil(preset: "30m" | "1h" | "2h" | "tomorrow" | "next-week", now = new Date()): Date {
  const d = new Date(now);
  switch (preset) {
    case "30m":
      return new Date(d.getTime() + 30 * 60_000);
    case "1h":
      return new Date(d.getTime() + 60 * 60_000);
    case "2h":
      return new Date(d.getTime() + 120 * 60_000);
    case "tomorrow": {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "next-week": {
      const toMonday = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + toMonday);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }
}

/** "4:00 PM", or "Tue 9:00 AM" when it isn't today. */
export function formatUntil(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`;
  const withinWeek = d.getTime() - now.getTime() < 6 * 86_400_000;
  return `${d.toLocaleDateString([], withinWeek ? { weekday: "short" } : { month: "short", day: "numeric" })} ${time}`;
}

/* ---------------------------------------------------- notification schedule */

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday (0–6) and minutes since midnight of `at` in time zone `tz` (falls back to local time). */
export function zonedClock(at: Date, tz: string | undefined): { day: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || undefined,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { day: WEEKDAYS[get("weekday")] ?? at.getDay(), minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  } catch {
    return { day: at.getDay(), minutes: at.getHours() * 60 + at.getMinutes() };
  }
}

/** True when `at` falls inside the schedule's allowed window (always true when the schedule is off). */
export function withinSchedule(schedule: NotifySchedule | null | undefined, at = new Date()): boolean {
  if (!schedule?.enabled) return true;
  const { day, minutes } = zonedClock(at, schedule.tz);
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);
  const days = new Set(schedule.days);
  if (start === end) return days.has(day);
  if (start < end) return days.has(day) && minutes >= start && minutes < end;
  // Overnight window (e.g. 22:00 → 06:00): the early-morning part belongs to the previous day's window.
  return (days.has(day) && minutes >= start) || (days.has((day + 6) % 7) && minutes < end);
}

export type QuietState = { quiet: false } | { quiet: true; reason: "dnd"; until: string } | { quiet: true; reason: "schedule" };

/** Whether notifications are currently paused, and why. */
export function quietState(prefs: Pick<Preferences, "notify_schedule">, dndUntil: string | null | undefined, now = new Date()): QuietState {
  if (dndUntil && dndActive(dndUntil, now.getTime())) return { quiet: true, reason: "dnd", until: dndUntil };
  if (!withinSchedule(prefs.notify_schedule, now)) return { quiet: true, reason: "schedule" };
  return { quiet: false };
}

/* --------------------------------------------------------- notify gate */

/** True when a message body mentions the user directly, via a group, or via @here/@channel/@everyone. */
export function mentionsMe(body: string, meId: string | undefined, groupIds: Iterable<string> = []): boolean {
  if (!meId || !body) return false;
  if (body.includes(`<@${meId}>`)) return true;
  if (body.includes("<!channel>") || body.includes("<!everyone>") || body.includes("<!here>")) return true;
  for (const g of groupIds) if (body.includes(`<!subteam^${g}>`)) return true;
  return false;
}

export type NotifyContext = {
  meId: string | undefined;
  prefs: Pick<Preferences, "desktop_notify" | "notify_schedule">;
  /** The signed-in user's dnd_until (defaults to the store's copy). */
  dndUntil?: string | null;
  /** The message's channel (for DM detection). */
  channel?: Pick<Channel, "kind"> | null;
  /** The channel's prefs (defaults to the store's copy). */
  channelPref?: ChannelPref | null;
  /** User groups the user belongs to, so <!subteam^ID> mentions count. */
  groupIds?: Iterable<string>;
  /** Treat the message as important regardless of mention (missed calls, reminders). */
  important?: boolean;
  now?: Date;
};

/**
 * Should a desktop notification (and sound) fire for this message?
 * Rules, in order: never for your own messages → DND / schedule silence everything → a muted channel or
 * notify="nothing" is silent → per-channel level overrides the global desktop_notify level →
 * "mentions" lets through DMs, direct/group/@here/@channel mentions and important events.
 */
export function shouldNotify(channelId: string, message: Pick<Message, "author_id" | "body" | "kind" | "meta">, ctx: NotifyContext): boolean {
  if (message.author_id === ctx.meId && !ctx.important) return false;
  const now = ctx.now ?? new Date();
  const dnd = ctx.dndUntil !== undefined ? ctx.dndUntil : state.dndUntil;
  if (quietState(ctx.prefs, dnd, now).quiet) return false;

  const pref = ctx.channelPref !== undefined ? ctx.channelPref : (state.prefs[channelId] ?? null);
  if (pref?.muted) return false;
  const level: NotifyLevel =
    pref && pref.notify !== "default" ? pref.notify : (ctx.prefs.desktop_notify ?? "mentions");
  if (level === "nothing") return false;
  if (level === "all") return true;

  const isReminder = message.kind === "system" && message.meta?.type === "reminder";
  return ctx.channel?.kind === "dm" || !!ctx.important || isReminder || mentionsMe(message.body, ctx.meId, ctx.groupIds);
}

/** Whether a channel is muted (unread counts still show but are de-emphasised). */
export function isMuted(channelId: string, s: SidebarState = state): boolean {
  return !!s.prefs[channelId]?.muted;
}

/* ------------------------------------------------------- sound & desktop */

let audioCtx: AudioContext | null = null;

/** A short two-tone chime (no asset needed). Silently does nothing if audio is unavailable. */
export function playNotificationSound(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {}
}

export type PermissionState = NotificationPermission | "unsupported";

export function notificationPermission(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const permListeners = new Set<() => void>();
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  const result = await Notification.requestPermission();
  permListeners.forEach((fn) => fn());
  return result;
}

function subscribePermission(fn: () => void) {
  permListeners.add(fn);
  window.addEventListener("focus", fn);
  return () => {
    permListeners.delete(fn);
    window.removeEventListener("focus", fn);
  };
}

/** Browser notification permission, re-read when it's requested or the window regains focus. */
export function useNotificationPermission(): PermissionState {
  return useSyncExternalStore(subscribePermission, notificationPermission, () => "unsupported" as PermissionState);
}

/** Show a desktop notification; returns false if the browser can't (no permission / no constructor). */
export function showDesktopNotification(title: string, options: NotificationOptions & { onClick?: () => void } = {}): boolean {
  if (notificationPermission() !== "granted") return false;
  const { onClick, ...opts } = options;
  try {
    const n = new Notification(title, opts);
    if (onClick)
      n.onclick = () => {
        bringToFront();
        onClick();
      };
    return true;
  } catch {
    // Android Chrome: `new Notification()` throws "Illegal constructor" (needs a service worker).
    return false;
  }
}

/* --------------------------------------------- other workspaces' unreads */

type WsUnread = { count: number; at: number };
const UNREAD_TTL = 60_000;
let wsUnreads: Record<string, WsUnread> = {};
const wsListeners = new Set<() => void>();
const inflight = new Set<string>();

/** Fetch unread totals of the given workspaces (cached 60 s; cheap enough to call on focus). */
export function refreshWorkspaceUnreads(ids: string[], force = false): void {
  const now = Date.now();
  for (const id of ids) {
    const cached = wsUnreads[id];
    if (inflight.has(id) || (!force && cached && now - cached.at < UNREAD_TTL)) continue;
    inflight.add(id);
    api<Channel[]>(`/workspaces/${id}/channels`)
      .then((chs) => {
        const count = chs.reduce((n, c) => n + (c.is_member || c.kind === "dm" ? c.unread_count : 0), 0);
        wsUnreads = { ...wsUnreads, [id]: { count, at: Date.now() } };
        wsListeners.forEach((fn) => fn());
      })
      .catch(() => {})
      .finally(() => inflight.delete(id));
  }
}

const EMPTY_UNREADS: Record<string, WsUnread> = {};
/** Cached unread totals of other workspaces (call `refreshWorkspaceUnreads` to update). */
export function useWorkspaceUnreads(): Record<string, WsUnread> {
  return useSyncExternalStore(
    (fn) => {
      wsListeners.add(fn);
      return () => {
        wsListeners.delete(fn);
      };
    },
    () => wsUnreads,
    () => EMPTY_UNREADS,
  );
}

/* ------------------------------------------------------ switcher & clock */

/** Whether the rail's workspace switcher is shown for this preference and workspace count. */
export function switcherVisible(pref: Preferences["show_workspace_switcher"] | undefined, workspaceCount: number): boolean {
  if (pref === "always") return true;
  if (pref === "never") return false;
  return workspaceCount > 1;
}

/** The preference value that flips the switcher's current visibility (⌘⇧S / workspace menu). */
export function toggledSwitcher(pref: Preferences["show_workspace_switcher"] | undefined, workspaceCount: number): Preferences["show_workspace_switcher"] {
  return switcherVisible(pref, workspaceCount) ? "never" : "always";
}

function subscribeMinute(fn: () => void) {
  const id = window.setInterval(fn, 15_000);
  window.addEventListener("focus", fn);
  return () => {
    window.clearInterval(id);
    window.removeEventListener("focus", fn);
  };
}

/** Minutes since the epoch, updated every ~15 s: re-renders DND pills when a pause ends. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribeMinute, () => Math.floor(Date.now() / 60_000), () => 0);
}

/* ------------------------------------------------------------ nav badges */

/** Server-backed counts for sidebar nav items (unreads/drafts are derived client-side). */
export type NavBadges = { activity: number; threads: number; later: number };
const NO_BADGES: NavBadges = { activity: 0, threads: 0, later: 0 };
let badges: { workspaceId: string | null; values: NavBadges } = { workspaceId: null, values: NO_BADGES };
const badgeListeners = new Set<() => void>();
let badgeSeq = 0;

/**
 * Refresh the Activity / Threads / Later counts. Each endpoint fails independently (a missing endpoint just
 * keeps its badge at 0), so the sidebar never breaks because one view's backend isn't there.
 */
export async function loadNavBadges(workspaceId: string): Promise<void> {
  const seq = ++badgeSeq;
  if (badges.workspaceId !== workspaceId) {
    badges = { workspaceId, values: NO_BADGES };
    badgeListeners.forEach((fn) => fn());
  }
  const [activity, threads, later] = await Promise.all([
    api<{ unread_count?: number }>(`/workspaces/${workspaceId}/activity?unread_only=true`)
      .then((r) => r.unread_count ?? 0)
      .catch(() => null),
    api<{ items?: { unread_count?: number }[] }>(`/workspaces/${workspaceId}/threads?unread_only=true`)
      .then((r) => (r.items ?? []).filter((t) => (t.unread_count ?? 0) > 0).length)
      .catch(() => null),
    api<unknown[]>(`/workspaces/${workspaceId}/later?status=in_progress`)
      .then((r) => (Array.isArray(r) ? r.length : 0))
      .catch(() => null),
  ]);
  if (seq !== badgeSeq || badges.workspaceId !== workspaceId) return;
  const prev = badges.values;
  const next: NavBadges = {
    activity: activity ?? prev.activity,
    threads: threads ?? prev.threads,
    later: later ?? prev.later,
  };
  if (next.activity === prev.activity && next.threads === prev.threads && next.later === prev.later) return;
  badges = { workspaceId, values: next };
  badgeListeners.forEach((fn) => fn());
}

export function useNavBadges(): NavBadges {
  return useSyncExternalStore(
    (fn) => {
      badgeListeners.add(fn);
      return () => {
        badgeListeners.delete(fn);
      };
    },
    () => badges.values,
    () => NO_BADGES,
  );
}
