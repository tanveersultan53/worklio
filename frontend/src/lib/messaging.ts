/**
 * Typed client for the Wave A2 messaging API (pins, bookmarks, forwarding, scheduled send,
 * polls, link unfurls, user groups, edit history, DM read receipts) plus the few A1 endpoints
 * the messaging UI drives directly (save for later, reminders, follow, DND, channel prefs).
 *
 * Every A2 field on a message is optional here so the UI degrades gracefully against older
 * payloads (e.g. while the backend is being rolled out).
 */
import { api, type Message, type RealtimeEvent, type User } from "@/lib/api";

// --- Types ---------------------------------------------------------------------------------

export type ForwardedFrom = {
  message_id: string;
  channel_id: string;
  author_id: string;
  created_at: string;
  body_preview: string;
};

export type PollOption = { id: string; text: string; votes: number; voter_ids: string[] };
export type Poll = {
  id: string;
  question: string;
  options: PollOption[];
  multiple: boolean;
  anonymous: boolean;
  closed: boolean;
  total_voters: number;
  /** Per-viewer; omitted (or empty) in realtime broadcasts. */
  my_votes?: string[] | null;
};

export type Unfurl = {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  favicon_url: string | null;
};

/** Fields MessageOut gains in Wave A (A1 `saved`, A2 the rest). */
export type MessageExtras = {
  pinned?: boolean;
  pinned_by?: string | null;
  forwarded_from?: ForwardedFrom | null;
  poll?: Poll | null;
  unfurls?: Unfurl[];
  edit_count?: number;
  scheduled?: boolean;
  saved?: boolean;
};
export type RichMessage = Message & MessageExtras;

/** View any message as carrying the Wave A fields (all optional). */
export const rich = (m: Message): RichMessage => m as RichMessage;

export type Bookmark = {
  id: string;
  channel_id: string;
  title: string;
  url: string;
  emoji: string | null;
  position: number;
  created_by: string;
};

export type ScheduledStatus = "pending" | "sent" | "failed" | "cancelled";
export type ScheduledMessage = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  body: string;
  attachment_ids: string[];
  send_at: string;
  status: ScheduledStatus;
  created_at: string;
};

export type UserGroup = {
  id: string;
  workspace_id: string;
  handle: string;
  name: string;
  member_ids: string[];
  created_by?: string | null;
  created_at?: string;
};
export type UserGroupInput = { handle: string; name: string; member_ids: string[] };

export type MessageEdit = { body: string; edited_at: string };

export type ReadState = { user_id: string; last_read_at: string | null };

export type Reminder = {
  id: string;
  workspace_id: string;
  text: string;
  remind_at: string;
  message_id: string | null;
  status: "pending" | "sent" | "cancelled";
  created_at: string;
};

export type SavedItem = {
  id: string;
  workspace_id: string;
  kind: "message" | "todo";
  message: Message | null;
  title: string | null;
  notes: string | null;
  status: "in_progress" | "completed" | "archived";
  due_at: string | null;
  remind_at: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ThreadState = { root_id: string; channel_id: string; following: boolean; unread_count: number };

export type ChannelPrefs = {
  channel_id: string;
  muted: boolean;
  notify: "default" | "all" | "mentions" | "nothing";
  starred: boolean;
  section_id: string | null;
};

/** Realtime events added by Wave A2 that the base `RealtimeEvent` union doesn't list yet. */
export type MessagingEvent =
  | { type: "bookmarks.updated"; channel_id: string; bookmarks: Bookmark[] }
  | { type: "channel.read"; channel_id: string; user_id: string; last_read_at: string };

/** Narrow a workspace event to one of the A2 messaging events. */
export function asMessagingEvent(e: RealtimeEvent): MessagingEvent | null {
  const type = (e as { type: string }).type;
  return type === "bookmarks.updated" || type === "channel.read" ? (e as unknown as MessagingEvent) : null;
}

// --- API -------------------------------------------------------------------------------------

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Fired after scheduling, cancelling or sending a scheduled message (the sidebar count listens). */
export const SCHEDULED_CHANGED = "worklio:scheduled-changed";
function scheduledChanged<T>(v: T): T {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SCHEDULED_CHANGED));
  return v;
}

export const messaging = {
  // Pins
  pin: (messageId: string) => api<Message | undefined>(`/messages/${messageId}/pin`, json("POST")),
  unpin: (messageId: string) => api<Message | undefined>(`/messages/${messageId}/pin`, json("DELETE")),
  pins: (channelId: string) => api<Message[]>(`/channels/${channelId}/pins`),

  // Bookmarks
  bookmarks: (channelId: string) => api<Bookmark[]>(`/channels/${channelId}/bookmarks`),
  addBookmark: (channelId: string, data: { title: string; url: string; emoji?: string | null }) =>
    api<Bookmark>(`/channels/${channelId}/bookmarks`, json("POST", data)),
  updateBookmark: (id: string, data: Partial<Pick<Bookmark, "title" | "url" | "emoji" | "position">>) =>
    api<Bookmark>(`/bookmarks/${id}`, json("PATCH", data)),
  deleteBookmark: (id: string) => api<void>(`/bookmarks/${id}`, json("DELETE")),

  // Forward
  forward: (messageId: string, channelIds: string[], comment?: string) =>
    api<Message[]>(
      `/messages/${messageId}/forward`,
      json("POST", { channel_ids: channelIds, ...(comment?.trim() ? { comment: comment.trim() } : {}) }),
    ),

  // Scheduled send
  schedule: (
    channelId: string,
    data: { body: string; parent_id?: string | null; attachment_ids?: string[]; send_at: string },
  ) => api<ScheduledMessage>(`/channels/${channelId}/scheduled`, json("POST", data)).then(scheduledChanged),
  scheduledList: (workspaceId: string) => api<ScheduledMessage[]>(`/workspaces/${workspaceId}/scheduled`),
  updateScheduled: (id: string, data: { body?: string; send_at?: string }) =>
    api<ScheduledMessage>(`/scheduled/${id}`, json("PATCH", data)),
  cancelScheduled: (id: string) => api<void>(`/scheduled/${id}`, json("DELETE")).then(scheduledChanged),
  sendScheduledNow: (id: string) => api<unknown>(`/scheduled/${id}/send-now`, json("POST")).then(scheduledChanged),

  // Polls
  createPoll: (
    channelId: string,
    data: { question: string; options: string[]; multiple?: boolean; anonymous?: boolean; parent_id?: string | null },
  ) => api<Message>(`/channels/${channelId}/polls`, json("POST", data)),
  /** Replaces my votes (empty list withdraws); returns the poll with my_votes. */
  vote: (pollId: string, optionIds: string[]) =>
    api<Poll | Message | undefined>(`/polls/${pollId}/vote`, json("POST", { option_ids: optionIds })),
  closePoll: (pollId: string) => api<Poll>(`/polls/${pollId}/close`, json("POST")),

  // Unfurls
  hideUnfurl: (messageId: string, index: number) => api<void>(`/messages/${messageId}/unfurls/${index}`, json("DELETE")),

  // User groups
  groups: (workspaceId: string) => api<UserGroup[]>(`/workspaces/${workspaceId}/groups`),
  createGroup: (workspaceId: string, data: UserGroupInput) =>
    api<UserGroup>(`/workspaces/${workspaceId}/groups`, json("POST", data)),
  updateGroup: (groupId: string, data: Partial<UserGroupInput>) => api<UserGroup>(`/groups/${groupId}`, json("PATCH", data)),
  deleteGroup: (groupId: string) => api<void>(`/groups/${groupId}`, json("DELETE")),

  // Edit history & read receipts
  edits: (messageId: string) => api<MessageEdit[]>(`/messages/${messageId}/edits`),
  readState: (channelId: string) => api<ReadState[]>(`/channels/${channelId}/read-state`),

  // --- A1 endpoints driven from the messaging UI ---
  save: (workspaceId: string, messageId: string) =>
    api<SavedItem>(`/workspaces/${workspaceId}/later`, json("POST", { message_id: messageId })),
  deleteSaved: (id: string) => api<void>(`/later/${id}`, json("DELETE")),
  remind: (workspaceId: string, data: { text: string; remind_at: string; message_id?: string | null }) =>
    api<Reminder>(`/workspaces/${workspaceId}/reminders`, json("POST", data)),
  cancelReminder: (id: string) => api<void>(`/reminders/${id}`, json("DELETE")),
  follow: (messageId: string) => api<ThreadState>(`/messages/${messageId}/follow`, json("POST")),
  unfollow: (messageId: string) => api<ThreadState>(`/messages/${messageId}/follow`, json("DELETE")),
  threadState: (messageId: string) => api<ThreadState>(`/messages/${messageId}/thread-state`),
  setDnd: (until: string | null) => api<User>("/auth/me/dnd", json("PUT", { until })),
  setStatus: (data: { emoji: string | null; text: string | null; expires_at?: string | null }) =>
    api<User>("/auth/me/status", json("PUT", data)),
  clearStatus: () => api<User>("/auth/me/status", json("DELETE")),
  channelPrefs: (workspaceId: string) => api<ChannelPrefs[]>(`/workspaces/${workspaceId}/channel-prefs`),
  setChannelPrefs: (channelId: string, data: Partial<Omit<ChannelPrefs, "channel_id">>) =>
    api<ChannelPrefs | undefined>(`/channels/${channelId}/prefs`, json("PATCH", data)),
};

// --- Helpers ---------------------------------------------------------------------------------

/** Only http(s) links are accepted for bookmarks (mirrors the server rule). */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
