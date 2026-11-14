/**
 * Typed client for the Wave A1 productivity endpoints (threads, activity, later/to-do,
 * reminders, sent, huddle history, files, unreads) plus the scheduled-send endpoints the
 * "Drafts & sent" view needs. Mirrors the WAVE A contract exactly; every call goes through `api()`.
 */

import { useSyncExternalStore } from "react";

import type { CallOut } from "@/components/calls/types";
import { api, type ChannelFile, type Message, type RealtimeEvent } from "@/lib/api";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Cursor-paginated list. `next_cursor` is null on the last page. */
export type Page<T> = { items: T[]; next_cursor: string | null };

/** MessageOut with the Wave A fields that may not be in lib/api.ts's Message yet. */
export type MessageOut = Message & { saved?: boolean; pinned?: boolean };

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export type ThreadItem = {
  root: MessageOut;
  channel_id: string;
  reply_count: number;
  last_reply_at: string | null;
  unread_count: number;
  participant_ids: string[];
  /** Up to 3 newest replies, oldest first. */
  latest_replies: MessageOut[];
};

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

export type ActivityFilter = "all" | "mentions" | "reactions" | "threads" | "invites";
export type ActivityType =
  | "mention"
  | "reaction"
  | "thread_reply"
  | "channel_invite"
  | "call_missed"
  | "reminder"
  /** Someone started a huddle in a channel you're in (meta: {call_id, kind}). */
  | "huddle_started"
  /** Someone @mentioned you in a Lists card comment (meta: {card_id, card_title, comment_id, excerpt}). */
  | "card_mention"
  /** Calendar (meta: {meeting_id, title, starts_at}): invited to a meeting / it starts in 10 minutes. */
  | "meeting_invite"
  | "meeting_reminder";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  created_at: string;
  read: boolean;
  actor_id: string | null;
  channel_id: string | null;
  message: MessageOut | null;
  emoji?: string | null;
  meta?: Record<string, unknown> | null;
};

export type ActivityPage = Page<ActivityItem> & { unread_count: number };

/** Which tab an activity item belongs to (besides "all"). */
export function activityMatches(filter: ActivityFilter, type: ActivityType): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mentions":
      return type === "mention" || type === "card_mention";
    case "reactions":
      return type === "reaction";
    case "threads":
      return type === "thread_reply";
    case "invites":
      return type === "channel_invite";
  }
}

// ---------------------------------------------------------------------------
// Later / to-do and reminders
// ---------------------------------------------------------------------------

export type SavedStatus = "in_progress" | "completed" | "archived";

export type SavedItem = {
  id: string;
  workspace_id: string;
  kind: "message" | "todo";
  message: MessageOut | null;
  title: string | null;
  notes: string | null;
  status: SavedStatus;
  due_at: string | null;
  remind_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type SavedCreate =
  | { message_id: string; notes?: string | null; due_at?: string | null; remind_at?: string | null }
  | { title: string; notes?: string | null; due_at?: string | null; remind_at?: string | null };

export type SavedPatch = Partial<Pick<SavedItem, "title" | "notes" | "status" | "due_at" | "remind_at">>;

export type Reminder = {
  id: string;
  workspace_id: string;
  text: string;
  remind_at: string;
  message_id: string | null;
  status: "pending" | "sent" | "cancelled";
  created_at: string;
};

// ---------------------------------------------------------------------------
// Scheduled messages (contract section A2; consumed by Drafts & sent)
// ---------------------------------------------------------------------------

export type ScheduledMessage = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  body: string;
  attachment_ids: string[];
  send_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  created_at: string;
};

// ---------------------------------------------------------------------------
// Huddles history, files, unreads
// ---------------------------------------------------------------------------

export type CallHistoryItem = CallOut & { channel_label_hint: string; notes_preview: string | null };

export type FileType = "all" | "images" | "videos" | "audio" | "documents" | "recordings";
export type WorkspaceFile = ChannelFile & { channel_id: string };

export type UnreadGroup = {
  channel_id: string;
  unread_count: number;
  first_unread_at: string | null;
  /** ≤ 20 newest unread, oldest first. */
  messages: MessageOut[];
};

// ---------------------------------------------------------------------------
// Realtime events (not yet in lib/api.ts's RealtimeEvent union)
// ---------------------------------------------------------------------------

export type ProductivityEvent =
  | { type: "thread.updated"; root_id: string; channel_id: string; unread_count: number }
  /** `notify` is the server's verdict after DND, notification schedule and channel mute/level. */
  | { type: "activity.new"; item: ActivityItem; notify?: boolean }
  | { type: "reminder.due"; reminder: Reminder };

const PRODUCTIVITY_TYPES = new Set(["thread.updated", "activity.new", "reminder.due"]);

/** Narrow a socket event to one of the productivity events, or null. */
export function asProductivityEvent(e: RealtimeEvent | { type: string }): ProductivityEvent | null {
  return PRODUCTIVITY_TYPES.has(e.type) ? (e as unknown as ProductivityEvent) : null;
}

/**
 * Fired after this client marks activity / threads / everything read, so the sidebar's nav badges
 * recount at once instead of waiting for the server echo or the next route change.
 */
export const BADGES_CHANGED_EVENT = "worklio:badges-changed";

function badgesChanged<T>(r: T): T {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BADGES_CHANGED_EVENT));
  return r;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

export const productivity = {
  // Threads
  threads: (ws: string, opts: { unreadOnly?: boolean; cursor?: string | null } = {}) =>
    api<Page<ThreadItem>>(`/workspaces/${ws}/threads${qs({ unread_only: opts.unreadOnly, cursor: opts.cursor })}`),
  followThread: (messageId: string) => api<void>(`/messages/${messageId}/follow`, json("POST")),
  unfollowThread: (messageId: string) => api<void>(`/messages/${messageId}/follow`, json("DELETE")),
  markThreadRead: (messageId: string) => api<void>(`/messages/${messageId}/thread-read`, json("POST")).then(badgesChanged),

  // Activity
  activity: (ws: string, opts: { type?: ActivityFilter; unreadOnly?: boolean; cursor?: string | null } = {}) =>
    api<ActivityPage>(
      `/workspaces/${ws}/activity${qs({ type: opts.type ?? "all", unread_only: opts.unreadOnly, cursor: opts.cursor })}`,
    ),
  markActivityRead: (ws: string, body: { ids: string[] } | { all: true }) =>
    api<void>(`/workspaces/${ws}/activity/read`, json("POST", body)).then(badgesChanged),

  // Later / to-do
  later: (ws: string, status: SavedStatus) => api<SavedItem[]>(`/workspaces/${ws}/later${qs({ status })}`),
  // Every successful write tells the sidebar's Later badge to recount (see notifyLaterChanged).
  createLater: (ws: string, body: SavedCreate) =>
    api<SavedItem>(`/workspaces/${ws}/later`, json("POST", body)).then((r) => {
      notifyLaterChanged({ workspaceId: ws });
      return r;
    }),
  updateLater: (id: string, patch: SavedPatch) =>
    api<SavedItem>(`/later/${id}`, json("PATCH", patch)).then((r) => {
      notifyLaterChanged({ workspaceId: r?.workspace_id });
      return r;
    }),
  deleteLater: (id: string) =>
    api<void>(`/later/${id}`, json("DELETE")).then((r) => {
      notifyLaterChanged();
      return r;
    }),

  // Reminders
  reminders: (ws: string, status: Reminder["status"] = "pending") =>
    api<Reminder[]>(`/workspaces/${ws}/reminders${qs({ status })}`),
  createReminder: (ws: string, body: { text: string; remind_at: string; message_id?: string | null }) =>
    api<Reminder>(`/workspaces/${ws}/reminders`, json("POST", body)),
  deleteReminder: (id: string) => api<void>(`/reminders/${id}`, json("DELETE")),

  // Sent / scheduled
  sent: (ws: string, cursor?: string | null) => api<Page<MessageOut>>(`/workspaces/${ws}/sent${qs({ cursor })}`),
  scheduled: (ws: string) => api<ScheduledMessage[]>(`/workspaces/${ws}/scheduled`),
  updateScheduled: (id: string, patch: { body?: string; send_at?: string }) =>
    api<ScheduledMessage>(`/scheduled/${id}`, json("PATCH", patch)),
  deleteScheduled: (id: string) => api<void>(`/scheduled/${id}`, json("DELETE")),
  sendScheduledNow: (id: string) => api<unknown>(`/scheduled/${id}/send-now`, json("POST")),

  // Huddles history
  calls: (ws: string, opts: { status?: "active" | "ended"; cursor?: string | null } = {}) =>
    api<Page<CallHistoryItem>>(`/workspaces/${ws}/calls${qs({ status: opts.status, cursor: opts.cursor })}`),

  // Files
  files: (
    ws: string,
    opts: { type?: FileType; userId?: string | null; channelId?: string | null; q?: string; cursor?: string | null } = {},
  ) =>
    api<Page<WorkspaceFile>>(
      `/workspaces/${ws}/files${qs({
        type: opts.type ?? "all",
        user_id: opts.userId,
        channel_id: opts.channelId,
        q: opts.q?.trim(),
        cursor: opts.cursor,
      })}`,
    ),

  // Unreads
  unreads: (ws: string) => api<UnreadGroup[]>(`/workspaces/${ws}/unreads`),
  readAll: (ws: string) => api<void>(`/workspaces/${ws}/read-all`, json("POST")).then(badgesChanged),
};

// ---------------------------------------------------------------------------
// Later badge: a tiny shared store for the number of in-progress items
// ---------------------------------------------------------------------------

/**
 * Window event fired whenever something may have changed the Later list (add, complete, archive,
 * delete, save-for-later from a message). The workspace shell listens and recounts. `delta` applies an
 * optimistic change right away (e.g. -1 when an item is completed); `refetch: false` skips the recount
 * (for the optimistic half of a write whose success will fire its own event).
 */
export const LATER_CHANGED_EVENT = "worklio:later-changed";
export type LaterChangedDetail = { workspaceId?: string; delta?: number; refetch?: boolean };

export function notifyLaterChanged(detail: LaterChangedDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LaterChangedDetail>(LATER_CHANGED_EVENT, { detail }));
}

let laterState: { workspaceId: string | null; n: number | null } = { workspaceId: null, n: null };
const laterListeners = new Set<() => void>();
let laterSeq = 0;
const emitLater = () => laterListeners.forEach((fn) => fn());

/** Recount in-progress Later items for `workspaceId` (failures keep the last known count). */
export function refreshLaterCount(workspaceId: string): Promise<void> {
  const seq = ++laterSeq;
  if (laterState.workspaceId !== workspaceId) {
    laterState = { workspaceId, n: null };
    emitLater();
  }
  return api<SavedItem[]>(`/workspaces/${workspaceId}/later${qs({ status: "in_progress" })}`)
    .then((list) => {
      if (seq !== laterSeq || laterState.workspaceId !== workspaceId) return;
      const n = Array.isArray(list) ? list.length : 0;
      if (n === laterState.n) return;
      laterState = { workspaceId, n };
      emitLater();
    })
    .catch(() => {});
}

/** Optimistically move the count (drops any recount already in flight, which may predate the change). */
export function adjustLaterCount(workspaceId: string, delta: number): void {
  if (!delta || laterState.workspaceId !== workspaceId || laterState.n === null) return;
  laterSeq++;
  laterState = { workspaceId, n: Math.max(0, laterState.n + delta) };
  emitLater();
}

function subscribeLater(fn: () => void) {
  laterListeners.add(fn);
  return () => {
    laterListeners.delete(fn);
  };
}

/** Live in-progress count for the workspace, or null before the first count arrives. */
export function useLaterCount(workspaceId: string): number | null {
  return useSyncExternalStore(
    subscribeLater,
    () => (laterState.workspaceId === workspaceId ? laterState.n : null),
    () => null,
  );
}

// ---------------------------------------------------------------------------
// Files: client-side mirror of the /files filters (for live inserts)
// ---------------------------------------------------------------------------

const RECORDING_KINDS = new Set(["voice", "video_clip", "screen_recording"]);

export type FileFilters = { type: FileType; userId: string | null; channelId: string | null; q: string };

/** Same rules as the server's `type` / `user_id` / `channel_id` / `q` filters. */
export function fileMatches(f: WorkspaceFile, filters: FileFilters): boolean {
  const ct = f.content_type || "";
  const media = ct.startsWith("image/") || ct.startsWith("video/") || ct.startsWith("audio/");
  const typeOk =
    filters.type === "all"
      ? true
      : filters.type === "images"
        ? ct.startsWith("image/")
        : filters.type === "videos"
          ? ct.startsWith("video/")
          : filters.type === "audio"
            ? ct.startsWith("audio/")
            : filters.type === "documents"
              ? !media && !f.kind
              : !!f.kind && RECORDING_KINDS.has(f.kind);
  if (!typeOk) return false;
  if (filters.userId && f.uploader_id !== filters.userId) return false;
  if (filters.channelId && f.channel_id !== filters.channelId) return false;
  const q = filters.q.trim().toLowerCase();
  return !q || f.filename.toLowerCase().includes(q);
}

/** The files a freshly created message carries, shaped like /files rows. */
export function filesOfMessage(m: Message): WorkspaceFile[] {
  return (m.attachments ?? []).map((a) => ({
    ...a,
    message_id: m.id,
    uploader_id: m.author_id,
    created_at: m.created_at,
    channel_id: m.channel_id,
  }));
}

// ---------------------------------------------------------------------------
// Time presets for due dates / reminders
// ---------------------------------------------------------------------------

export type TimePreset = { id: string; label: string; hint: string; at: Date };

const atHour = (d: Date, h: number) => {
  const x = new Date(d);
  x.setHours(h, 0, 0, 0);
  return x;
};

/** "In 20 min · 1 hour · 3 hours · Tomorrow 9:00 · Next week (Mon 9:00)", computed from `now`. */
export function timePresets(now: Date): TimePreset[] {
  const tomorrow = atHour(new Date(now.getTime() + 86_400_000), 9);
  const nextWeek = new Date(now);
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  nextWeek.setDate(now.getDate() + daysToMonday);
  const monday = atHour(nextWeek, 9);
  const short = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const inMin = (m: number) => new Date(now.getTime() + m * 60_000);
  return [
    { id: "20m", label: "In 20 minutes", hint: short(inMin(20)), at: inMin(20) },
    { id: "1h", label: "In 1 hour", hint: short(inMin(60)), at: inMin(60) },
    { id: "3h", label: "In 3 hours", hint: short(inMin(180)), at: inMin(180) },
    { id: "tomorrow", label: "Tomorrow", hint: `${tomorrow.toLocaleDateString([], { weekday: "short" })} ${short(tomorrow)}`, at: tomorrow },
    { id: "next-week", label: "Next week", hint: `${monday.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${short(monday)}`, at: monday },
  ];
}

/** "Today at 3:00 PM" · "Tomorrow at 9:00 AM" · "Mon, Nov 18 at 9:00 AM" · "Nov 18, 2027 at …" */
export function whenLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ref = now ? new Date(now) : new Date(d);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(d) - day(ref)) / 86_400_000);
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Tomorrow at ${time}`;
  if (diffDays === -1) return `Yesterday at ${time}`;
  const sameYear = d.getFullYear() === ref.getFullYear();
  const date = d.toLocaleDateString([], {
    weekday: Math.abs(diffDays) < 7 ? "short" : undefined,
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  return `${date} at ${time}`;
}

/** Compact relative time: "now", "5m", "3h", "2d", or a short date. */
export function shortAgo(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (!now || Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
