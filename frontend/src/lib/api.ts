export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

const TOKEN_KEY = "worklio.token";
const REFRESH_KEY = "worklio.refresh";

const read = (k: string) => (typeof window === "undefined" ? null : localStorage.getItem(k));

export type Session = { access_token: string; refresh_token?: string | null };

export const auth = {
  get: () => read(TOKEN_KEY),
  /** Replace the access token only (keeps the refresh token). */
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  /** Store a full sign-in result from /auth/login, /auth/register or /auth/refresh. */
  setSession: (s: Session) => {
    localStorage.setItem(TOKEN_KEY, s.access_token);
    if (s.refresh_token) localStorage.setItem(REFRESH_KEY, s.refresh_token);
  },
  refreshToken: () => read(REFRESH_KEY),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

/** Seconds-since-epoch expiry of a JWT, or 0 if it can't be read. */
function tokenExp(token: string): number {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return Number(JSON.parse(atob(part)).exp) || 0;
  } catch {
    return 0;
  }
}

let inflight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const started = auth.refreshToken();
  if (!started) return null;
  const run = async (): Promise<string | null> => {
    // Another tab may have rotated the token while we waited for the lock: use its result.
    const current = auth.refreshToken();
    if (!current) return null;
    if (current !== started) return auth.get();
    let res: Response;
    try {
      res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current }),
      });
    } catch {
      return null; // offline: keep the session, try again later
    }
    if (res.status === 401) {
      auth.clear();
      return null;
    }
    if (!res.ok) return null;
    const pair = (await res.json()) as Session;
    auth.setSession(pair);
    return pair.access_token;
  };
  // Serialise across tabs: two tabs spending the same refresh token would look like theft
  // to the server and end the session.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request("worklio-refresh", run) : run();
}

/** Exchange the refresh token for a new access token (single flight per tab). */
export function refreshSession(): Promise<string | null> {
  inflight ??= doRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** A usable access token: the stored one, or a refreshed one if it expires within a minute. */
export async function freshToken(): Promise<string | null> {
  const token = auth.get();
  if (token && tokenExp(token) * 1000 - Date.now() > 60_000) return token;
  if (auth.refreshToken()) return (await refreshSession()) ?? auth.get();
  return token;
}

/** Sign this device out on the server too, then forget the tokens locally. */
export async function signOut(): Promise<void> {
  const refresh = auth.refreshToken();
  auth.clear();
  if (!refresh) return;
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    keepalive: true,
  }).catch(() => {});
}

// Keep the session alive in the background so direct fetches, uploads and the WebSocket
// always have a valid token, including after the laptop wakes up.
if (typeof window !== "undefined" && !(window as { __worklioKeeper?: boolean }).__worklioKeeper) {
  (window as { __worklioKeeper?: boolean }).__worklioKeeper = true;
  const tick = () => {
    if (auth.refreshToken()) void freshToken();
  };
  setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tick());
  window.addEventListener("online", tick);
}

export class ApiError extends Error {
  /** Parsed JSON error body (e.g. a 409 canvas conflict carries `{detail, canvas}`), or {} if none. */
  constructor(public status: number, message: string, public body: Record<string, unknown> = {}) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const isAuthCall = path.startsWith("/auth/login") || path.startsWith("/auth/register") || path.startsWith("/auth/refresh");
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  let res = await send(isAuthCall ? null : await freshToken());
  if (res.status === 401 && !isAuthCall && auth.refreshToken()) {
    // The access token was rejected (expired or revoked): refresh once and retry.
    const renewed = await refreshSession();
    if (renewed) res = await send(renewed);
  }
  if (res.status === 401 && !isAuthCall) auth.clear();
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : res.statusText;
    throw new ApiError(res.status, detail, body && typeof body === "object" ? body : {});
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Optional metadata for media uploads (voice notes and video clips). */
export type UploadMeta = {
  kind?: AttachmentKind;
  /** Length of the recording in ms (≤ 600000). */
  duration_ms?: number;
  /** ≤ 64 peaks, each 0–100, used to draw the voice-message waveform. */
  waveform?: number[];
};

export function uploadFile(workspaceId: string, file: File, meta: UploadMeta = {}): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  if (meta.kind) form.append("kind", meta.kind);
  if (meta.duration_ms != null) form.append("duration_ms", String(Math.round(meta.duration_ms)));
  if (meta.waveform?.length) form.append("waveform", JSON.stringify(meta.waveform.slice(0, 64)));
  return api<Attachment>(`/workspaces/${workspaceId}/uploads`, { method: "POST", body: form });
}

// --- Types mirroring backend/app/schemas ---
/** Profile v2 fields shared by User and Member. All nullable; an expired status arrives as all-null. */
export type ProfileFields = {
  title?: string | null;
  pronouns?: string | null;
  /** IANA time zone name, e.g. "Europe/Berlin". */
  timezone?: string | null;
  phone?: string | null;
  status_emoji?: string | null;
  status_text?: string | null;
  /** ISO timestamp, or null for "don't clear". */
  status_expires_at?: string | null;
  /** Absolute URL of the profile photo (302 to storage), or null for the generated avatar. */
  avatar_url?: string | null;
  /** Do-not-disturb end (ISO); null/absent when notifications aren't paused. Expired values arrive as null. */
  dnd_until?: string | null;
  /** True for the per-workspace "Worklio" AI bot user (never a person; excluded from people counts). */
  is_bot?: boolean;
};
export type User = ProfileFields & {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  preferences?: Partial<import("@/lib/appearance").Preferences>;
};
export type Workspace = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
  /** Uploaded workspace icon, or null to show initials. */
  icon_url?: string | null;
};
export type Member = ProfileFields & {
  user_id: string;
  full_name: string;
  /** null when the viewer is a guest. */
  email: string | null;
  role: "owner" | "admin" | "member" | "guest";
};
export type Channel = {
  id: string;
  workspace_id: string;
  name: string;
  topic: string | null;
  kind: "public" | "private" | "dm";
  is_archived: boolean;
  created_at: string;
  is_member: boolean;
  unread_count: number;
  member_ids: string[];
  /** The viewer's role in this channel ("manager" can rename/archive/remove people); null when not a member. */
  my_role?: "manager" | "member" | null;
};
export type Reaction = { emoji: string; user_ids: string[] };
export type AttachmentKind = "voice" | "video_clip" | "screen_recording";
export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  /** Set for recorded voice messages / video clips / screen recordings; null for ordinary files. */
  kind?: AttachmentKind | null;
  duration_ms?: number | null;
  /** Normalised peaks (0–100) for voice messages. */
  waveform?: number[] | null;
};
export type Message = {
  id: string;
  workspace_id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_count: number;
  last_reply_at: string | null;
  reply_user_ids: string[];
  reactions: Reaction[];
  attachments: Attachment[];
  /** "system" for server-authored messages (call cards, call notes). Missing on older payloads = "user". */
  kind?: "user" | "system";
  /** Structured payload for system messages, e.g. {type:"call", ...} or {type:"call_notes", call_id}. */
  meta?: Record<string, unknown> | null;
} & import("@/lib/messaging").MessageExtras;

export type ChannelFile = Attachment & { message_id: string; uploader_id: string; created_at: string };

export type RealtimeEvent =
  | { type: "message.created" | "message.updated"; message: Message }
  | { type: "message.deleted"; message_id: string; channel_id: string; parent_id: string | null }
  | { type: "reaction.updated"; message_id: string; channel_id: string; parent_id: string | null; reactions: Reaction[] }
  | { type: "typing"; channel_id: string; user_id: string; parent_id?: string | null }
  /** Live caption frame from a call participant (interim when `final` is false). */
  | { type: "call.caption"; call_id: string; user_id: string; text: string; final: boolean; ts: string }
  /** Progress line from the @worklio agent while it works on a reply to `message_id`. */
  | { type: "ai.agent_status"; channel_id: string; message_id: string; text: string }
  | { type: "presence"; user_id: string; online: boolean }
  | { type: "channel.joined" | "channel.left"; channel_id: string }
  | { type: "channel.created"; channel: Channel }
  | { type: "channel.member_joined" | "channel.member_left"; channel_id: string; user_id: string }
  | { type: "channel.updated"; channel_id: string; topic: string | null; name?: string; is_archived?: boolean }
  | { type: "workspace.joined"; workspace_id: string }
  /** Workspace admin (Wave D1): settings/policies/icon changed (workspace topic). */
  | { type: "workspace.updated"; workspace_id: string }
  /** Someone's role changed, or a member joined / was deactivated / reactivated / removed (workspace topic). */
  | { type: "member.updated"; workspace_id: string; user_id: string; role: Member["role"] }
  | {
      type: "member.joined" | "member.deactivated" | "member.reactivated" | "member.removed";
      workspace_id: string;
      user_id: string;
    }
  /** Per-user: my own role in a workspace changed. */
  | { type: "workspace.role_changed"; workspace_id: string; role: Member["role"] }
  /** Per-user: I was deactivated in / removed from a workspace (my sockets close right after). */
  | { type: "workspace.access_revoked"; workspace_id: string }
  | { type: "channel.member_role_changed"; channel_id: string; user_id: string; role: "manager" | "member" }
  /** Worklio AI was added to / removed from a channel (channel topic). */
  | { type: "ai.agent_installed"; channel_id: string; installed: boolean }
  /** A user's profile/status/photo changed. `user` is Member-shaped for one of their workspaces. */
  | { type: "user.updated"; user: Member }
  /** Authoritative board snapshot after any change (channel topic). */
  | { type: "board.updated"; channel_id: string; board: import("@/components/board/types").Board }
  | { type: "canvas.updated"; channel_id: string; canvas: import("@/components/canvas/types").Canvas }
  /** Someone is viewing a channel's canvas (re-broadcast of a client `canvas.presence` frame). */
  | { type: "canvas.presence"; channel_id: string; user_id: string }
  /** Huddle participants changed; an empty list means the huddle ended. */
  | {
      type: "huddle.updated";
      channel_id: string;
      participant_ids: string[];
      started_at: string | null;
    }
  /**
   * Per-user: someone started a huddle in a (non-DM) channel I'm in. Never sent to the starter.
   * `invited`: I'm being rung too (the incoming-call UI handles it). `notify`: my prefs allow a sound / desktop alert.
   */
  | {
      type: "huddle.started";
      call: import("@/components/calls/types").CallOut;
      channel_id: string;
      starter_id: string;
      invited: boolean;
      notify: boolean;
    }
  /** The huddle that `huddle.started` announced is over. */
  | { type: "huddle.ended"; call_id: string; channel_id: string }
  /** Calls: ringing / ring_stopped / invite_updated are per-user; updated / notes_updated go to the channel. */
  | import("@/components/calls/types").CallRealtimeEvent
  /** Calendar: a meeting I'm in changed / is starting now (per-user). */
  | import("@/lib/meetings").MeetingRealtimeEvent
  /** Live whiteboard edits / cursors (re-broadcast of client frames; ignore your own `client_id`). */
  | import("@/components/whiteboard/types").WhiteboardRealtimeEvent
  /** A whiteboard save landed: its new version (lets open boards advance their base_version). */
  | { type: "whiteboard.saved"; channel_id: string; version: number; user_id: string | null }
  /** Wave C canvases (Yjs sync, presence, comments, metadata) — see lib/canvas.ts. */
  | import("@/lib/canvas").CanvasServerEvent
  /** Wave C lists: a card's comment thread changed (refetch it). */
  | import("@/components/board/types").BoardCommentsUpdatedEvent
  /** A Lists card comment mentioned you (direct push while Activity lacks the item). */
  | {
      type: "board.mention";
      activity_id: string;
      channel_id: string;
      card_id: string;
      card_title: string;
      comment_id: string;
      excerpt: string;
      actor_id: string | null;
      notify: boolean;
    }
  /** Wave A1 per-user productivity events (threads, activity, reminders). */
  | import("@/lib/productivity").ProductivityEvent
  /** Wave A2 channel events (bookmarks, DM read receipts). */
  | import("@/lib/messaging").MessagingEvent
  | { type: "pong" }
  /** The socket reconnected (client-side) or the server dropped events: refetch anything that may have been missed. */
  | { type: "resync" };

export type ConnectionStatus = "connecting" | "open" | "reconnecting";
