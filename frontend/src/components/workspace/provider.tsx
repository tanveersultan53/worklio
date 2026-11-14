"use client";

import { useParams, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAppearance } from "@/components/appearance-provider";
import { useRealtime } from "@/hooks/use-realtime";
import {
  api,
  ApiError,
  auth,
  type Channel,
  type ConnectionStatus,
  type Member, type Message,
  type RealtimeEvent,
  type User,
  type Workspace,
} from "@/lib/api";
import { notifyAIChanged } from "@/lib/admin";
import { bringToFront, isAway } from "@/lib/desktop";
import { decodeMentions } from "@/lib/format";
import { groupIdsFor, refreshGroups } from "@/components/messaging/use-groups";
import { asProductivityEvent } from "@/lib/productivity";
import { loadSidebar, playNotificationSound, shouldNotify } from "@/lib/sidebar";
import { toast } from "@/lib/toast";

type Listener = (e: RealtimeEvent) => void;

type WorkspaceCtx = {
  workspaceId: string;
  activeChannelId: string | undefined;
  me: User | null;
  workspace: Workspace | undefined;
  workspaces: Workspace[];
  channels: Channel[];
  /** True once the first channel list for this workspace has arrived (or failed). */
  channelsLoaded: boolean;
  members: Member[];
  memberById: Record<string, Member>;
  online: Set<string>;
  typing: Record<string, Record<string, number>>; // channelId -> userId -> last seen
  isAdmin: boolean;
  reloadChannels: () => Promise<void>;
  reloadMembers: () => Promise<void>;
  reloadWorkspaces: () => Promise<void>;
  markRead: (channelId: string) => void;
  channelLabel: (c: Channel) => string;
  sendTyping: (channelId: string) => void;
  /** Write a raw client→server frame on the shared WebSocket (no-op while disconnected). */
  sendRealtime: (frame: object) => void;
  /** Realtime socket state, for the "Reconnecting…" banner. */
  connection: ConnectionStatus;
  subscribe: (fn: Listener) => () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  searchQuery: string | null;
  setSearchQuery: (q: string | null) => void;
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  openDM: (userIds: string[]) => Promise<void>;
  profileOpen: boolean;
  setProfileOpen: (open: boolean) => void;
  setMe: (u: User) => void;
  preferencesOpen: boolean;
  setPreferencesOpen: (open: boolean) => void;
  focusMode: boolean;
  setFocusMode: (on: boolean | ((on: boolean) => boolean)) => void;
};

const Ctx = createContext<WorkspaceCtx | null>(null);

export function useWorkspace(): WorkspaceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/** Like useWorkspace(), but returns null outside <WorkspaceProvider> (for shared components such as avatars). */
export function useOptionalWorkspace(): WorkspaceCtx | null {
  return useContext(Ctx);
}

/** Profile fields carried by a "user.updated" event. Role/email are per-workspace, so they're never copied. */
const PROFILE_KEYS = [
  "full_name",
  "title",
  "pronouns",
  "timezone",
  "phone",
  "status_emoji",
  "status_text",
  "status_expires_at",
  "avatar_url",
  "dnd_until",
] as const;

type ProfilePatch = Partial<Pick<Member, (typeof PROFILE_KEYS)[number]>>;

function pickProfile(m: Member): ProfilePatch {
  const out: Record<string, unknown> = {};
  for (const k of PROFILE_KEYS) if (k in m) out[k] = m[k];
  return out as ProfilePatch;
}

/** Subscribe a component to realtime events for as long as it's mounted. */
export function useWorkspaceEvents(handler: Listener) {
  const { subscribe } = useWorkspace();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };

const LAST_WORKSPACE_KEY = "worklio.lastWorkspace";
export const lastWorkspace = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(LAST_WORKSPACE_KEY)),
  set: (id: string) => localStorage.setItem(LAST_WORKSPACE_KEY, id),
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId, channelId } = useParams<{ workspaceId: string; channelId?: string }>();
  const router = useRouter();

  const [me, setMe] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoadedFor, setChannelsLoadedFor] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const { hydrateFromServer, prefs: appearancePrefs } = useAppearance();

  const listeners = useRef(new Set<Listener>());
  const activeChannel = useRef(channelId);
  const meRef = useRef<User | null>(null);
  const channelsRef = useRef<Channel[]>([]);
  const membersRef = useRef<Record<string, Member>>({});
  /** Call cards already counted as a missed call (message.updated can repeat for the same card). */
  const missedCalls = useRef(new Set<string>());
  /** Message ids already notified (message.created and activity.new can describe the same message). */
  const notified = useRef(new Set<string>());
  const prefsRef = useRef(appearancePrefs);
  useEffect(() => {
    activeChannel.current = channelId;
    meRef.current = me;
    channelsRef.current = channels;
    prefsRef.current = appearancePrefs;
  });

  const reloadChannels = useCallback(
    () => api<Channel[]>(`/workspaces/${workspaceId}/channels`).then(setChannels),
    [workspaceId],
  );
  const reloadMembers = useCallback(
    () => api<Member[]>(`/workspaces/${workspaceId}/members`).then(setMembers),
    [workspaceId],
  );
  const reloadWorkspaces = useCallback(() => api<Workspace[]>("/workspaces").then(setWorkspaces), []);
  const reloadPresence = useCallback(
    () =>
      api<{ online_user_ids: string[] }>(`/workspaces/${workspaceId}/presence`)
        .then((p) => setOnline(new Set(p.online_user_ids)))
        .catch(() => {}),
    [workspaceId],
  );

  useEffect(() => {
    if (!auth.get()) {
      router.replace("/login");
      return;
    }
    api<User>("/auth/me")
      .then((u) => {
        setMe(u);
        hydrateFromServer(u.preferences);
      })
      .catch(() => router.replace("/login"));
    reloadWorkspaces().catch(() => {});
    // Members is the membership check: a stale or foreign workspace id bounces back to the entry point.
    reloadMembers()
      .then(() => lastWorkspace.set(workspaceId))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.message === "account_deactivated") {
          toast.error("Your account in this workspace has been deactivated. Ask a workspace admin to restore it.");
        }
        router.replace("/");
      });
    reloadChannels()
      .catch(() => {})
      .finally(() => setChannelsLoadedFor(workspaceId));
    reloadPresence();
  }, [workspaceId, router, reloadChannels, reloadMembers, reloadWorkspaces, reloadPresence, hydrateFromServer]);

  // Expire typing indicators.
  useEffect(() => {
    const id = setInterval(() => {
      setTyping((t) => {
        const now = Date.now();
        let changed = false;
        const next: typeof t = {};
        for (const [cid, users] of Object.entries(t)) {
          const live = Object.fromEntries(Object.entries(users).filter(([, ts]) => now - ts < 4000));
          if (Object.keys(live).length !== Object.keys(users).length) changed = true;
          if (Object.keys(live).length) next[cid] = live;
        }
        return changed ? next : t;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  /** Fire one desktop notification (+ optional chime) per key; later duplicates are dropped. */
  function deliver(key: string, title: string, body: string, href: string | null) {
    if (notified.current.has(key)) return;
    notified.current.add(key);
    if (notified.current.size > 500) notified.current = new Set([...notified.current].slice(-250));
    if (prefsRef.current.notify_sound) playNotificationSound();
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, { body, tag: key });
      n.onclick = () => {
        bringToFront();
        if (href) router.push(href);
      };
    } catch {
      // Android Chrome: `new Notification()` throws "Illegal constructor" (needs a service worker).
    }
  }

  /**
   * Desktop notification for a message when the user isn't looking at that conversation.
   * Gated by `shouldNotify`: DND, the notification schedule, per-channel mute / level and the
   * global desktop_notify level ("mentions" lets DMs, @mentions, @here/@channel and groups through).
   */
  function notify(m: Message, missedCall = false) {
    // System messages only notify for a missed call; everything else is server chatter.
    if (m.kind === "system" && !missedCall) return;
    if (m.author_id === meRef.current?.id) return;
    if (!isAway() && m.channel_id === activeChannel.current) return;
    const channel = channelsRef.current.find((c) => c.id === m.channel_id);
    const meId = meRef.current?.id;
    if (
      !shouldNotify(m.channel_id, m, {
        meId,
        prefs: prefsRef.current,
        channel,
        groupIds: groupIdsFor(m.workspace_id, meId),
        important: missedCall,
      })
    )
      return;
    const isDM = channel?.kind === "dm";
    const author = membersRef.current[m.author_id]?.full_name ?? "Someone";
    const where = isDM ? "" : ` in #${channel?.name ?? "channel"}`;
    const body = missedCall
      ? `Missed ${m.meta?.kind === "video" ? "video " : ""}call`
      : decodeMentions(m.body, membersRef.current) || "Sent an attachment";
    deliver(m.id, `${author}${where}`, body, `/w/${m.workspace_id}/c/${m.channel_id}`);
  }

  /** Per-user productivity events: activity items (thread replies, invites…) and due reminders. */
  function onProductivity(e: RealtimeEvent) {
    const p = asProductivityEvent(e);
    if (!p) return;
    if (p.type === "reminder.due") {
      const r = p.reminder;
      if (r.workspace_id !== workspaceId) return;
      toast.info(`⏰ Reminder: ${r.text}`);
      const meId = meRef.current?.id;
      const fake = { author_id: "", body: r.text, kind: "system" as const, meta: { type: "reminder" } };
      if (!shouldNotify("", fake, { meId, prefs: prefsRef.current, channelPref: null, important: true })) return;
      deliver(`reminder:${r.id}`, "⏰ Reminder", r.text, `/w/${workspaceId}/later`);
      return;
    }
    if (p.type !== "activity.new" || p.notify === false) return;
    const item = p.item;
    // Mentions and missed calls are already notified from the channel's own message events;
    // reactions are informational. Thread replies and channel invites only arrive here.
    if (item.type !== "thread_reply" && item.type !== "channel_invite" && item.type !== "card_mention") return;
    const channel = item.channel_id ? channelsRef.current.find((c) => c.id === item.channel_id) : undefined;
    if (!channel) return; // another workspace's item (or a channel this tab hasn't loaded yet)
    const meId = meRef.current?.id;
    const actor = (item.actor_id && membersRef.current[item.actor_id]?.full_name) || "Someone";
    if (item.type === "card_mention") {
      const meta = item.meta ?? {};
      const cardId = typeof meta.card_id === "string" ? meta.card_id : "";
      const title = typeof meta.card_title === "string" && meta.card_title ? meta.card_title : "a card";
      const excerpt = typeof meta.excerpt === "string" ? meta.excerpt : "";
      if (!shouldNotify(channel.id, { author_id: item.actor_id ?? "", body: "", kind: "user", meta: null }, {
        meId, prefs: prefsRef.current, channel, important: true,
      }))
        return;
      deliver(
        `card-mention:${item.id}`,
        `${actor} mentioned you on “${title}” in #${channel.name}`,
        decodeMentions(excerpt, membersRef.current) || "Open the card to reply",
        `/w/${workspaceId}/c/${channel.id}?tab=board${cardId ? `&card=${encodeURIComponent(cardId)}` : ""}`,
      );
      return;
    }
    if (item.type === "channel_invite") {
      reloadChannels().catch(() => {});
      if (!shouldNotify(channel.id, { author_id: item.actor_id ?? "", body: "", kind: "user", meta: null }, {
        meId, prefs: prefsRef.current, channel, important: true,
      }))
        return;
      deliver(`invite:${item.id}`, `${actor} added you to #${channel.name}`, "Open the channel to catch up", `/w/${workspaceId}/c/${channel.id}`);
      return;
    }
    const m = item.message;
    if (!m || m.author_id === meId) return;
    if (!isAway() && m.channel_id === activeChannel.current) return;
    if (!shouldNotify(channel.id, m, { meId, prefs: prefsRef.current, channel, groupIds: groupIdsFor(m.workspace_id, meId), important: true })) return;
    const where = channel.kind === "dm" ? "" : ` in #${channel.name}`;
    deliver(m.id, `${actor} replied to a thread${where}`, decodeMentions(m.body, membersRef.current) || "Sent an attachment", `/w/${workspaceId}/c/${channel.id}`);
  }

  const { sendTyping, send: sendRealtime, status: connection } = useRealtime((e) => {
    switch (e.type) {
      case "message.created": {
        const m = e.message;
        if (m.workspace_id !== workspaceId) break;
        setTyping((t) => {
          if (!t[m.channel_id]?.[m.author_id]) return t;
          const users = { ...t[m.channel_id] };
          delete users[m.author_id];
          return { ...t, [m.channel_id]: users };
        });
        if (
          !m.parent_id &&
          m.kind !== "system" &&
          m.author_id !== meRef.current?.id &&
          m.channel_id !== activeChannel.current
        ) {
          setChannels((cs) => cs.map((c) => (c.id === m.channel_id ? { ...c, unread_count: c.unread_count + 1 } : c)));
        }
        notify(m);
        break;
      }
      case "message.updated": {
        // A call card flipping to "missed" counts as unread (the server counts it too) and notifies.
        const m = e.message;
        if (m.workspace_id !== workspaceId || m.kind !== "system" || m.parent_id) break;
        if (m.meta?.type !== "call" || m.meta?.status !== "missed") break;
        if (m.author_id === meRef.current?.id || missedCalls.current.has(m.id)) break;
        missedCalls.current.add(m.id);
        if (m.channel_id !== activeChannel.current) {
          setChannels((cs) => cs.map((c) => (c.id === m.channel_id ? { ...c, unread_count: c.unread_count + 1 } : c)));
        }
        notify(m, true);
        break;
      }
      case "channel.updated": {
        // Older servers only sent `topic`; rename/archive also carry `name` and `is_archived`.
        setChannels((cs) =>
          cs.map((c) =>
            c.id === e.channel_id
              ? {
                  ...c,
                  topic: e.topic,
                  name: e.name ?? c.name,
                  is_archived: e.is_archived ?? c.is_archived,
                }
              : c,
          ),
        );
        break;
      }
      case "channel.member_role_changed":
        if (e.user_id === meRef.current?.id) {
          setChannels((cs) => cs.map((c) => (c.id === e.channel_id ? { ...c, my_role: e.role } : c)));
        }
        break;
      case "ai.agent_installed":
        // The Ask Worklio header, @worklio suggestions and channel details read installs from AI status.
        notifyAIChanged(workspaceId);
        break;
      case "workspace.updated":
        if (e.workspace_id !== workspaceId) break;
        // Name/icon live on the workspace list; policies (e.g. use_ai) gate the AI UI.
        reloadWorkspaces().catch(() => {});
        notifyAIChanged(workspaceId);
        break;
      case "member.updated":
        if (e.workspace_id !== workspaceId) break;
        setMembers((ms) => ms.map((m) => (m.user_id === e.user_id ? { ...m, role: e.role } : m)));
        break;
      case "member.joined":
      case "member.reactivated":
        if (e.workspace_id === workspaceId) reloadMembers().catch(() => {});
        break;
      case "member.deactivated":
      case "member.removed":
        if (e.workspace_id !== workspaceId || e.user_id === meRef.current?.id) break;
        setMembers((ms) => ms.filter((m) => m.user_id !== e.user_id));
        setOnline((o) => {
          if (!o.has(e.user_id)) return o;
          const next = new Set(o);
          next.delete(e.user_id);
          return next;
        });
        break;
      case "workspace.role_changed": {
        reloadWorkspaces().catch(() => {});
        if (e.workspace_id !== workspaceId) break;
        const myId = meRef.current?.id;
        if (myId) setMembers((ms) => ms.map((m) => (m.user_id === myId ? { ...m, role: e.role } : m)));
        // Guests see fewer channels; admins may see more controls.
        reloadChannels().catch(() => {});
        reloadMembers().catch(() => {});
        notifyAIChanged(workspaceId);
        toast.info(`Your role in this workspace is now ${ROLE_LABEL[e.role] ?? e.role}`);
        break;
      }
      case "workspace.access_revoked":
        if (e.workspace_id !== workspaceId) {
          reloadWorkspaces().catch(() => {});
          break;
        }
        toast.error("You no longer have access to this workspace");
        router.replace("/");
        break;
      case "typing":
        // Thread typing (parent_id set) isn't a channel-level "is typing".
        if (e.user_id !== meRef.current?.id && !e.parent_id)
          setTyping((t) => ({ ...t, [e.channel_id]: { ...t[e.channel_id], [e.user_id]: Date.now() } }));
        break;
      case "presence":
        setOnline((s) => {
          const next = new Set(s);
          if (e.online) next.add(e.user_id);
          else next.delete(e.user_id);
          return next;
        });
        break;
      case "channel.joined":
      case "channel.left":
        reloadChannels().catch(() => {});
        break;
      case "channel.created": {
        const created = e.channel;
        if (created.workspace_id !== workspaceId) break;
        setChannels((cs) => (cs.some((c) => c.id === created.id) ? cs : [...cs, created]));
        break;
      }
      case "channel.member_joined":
      case "channel.member_left":
        // Keeps member_ids (DM labels, counts) current; open channel views refresh their own list.
        if (channelsRef.current.some((c) => c.id === e.channel_id)) reloadChannels().catch(() => {});
        break;
      case "resync":
        reloadChannels().catch(() => {});
        reloadMembers().catch(() => {});
        reloadPresence();
        setTyping({});
        break;
      case "workspace.joined":
        reloadWorkspaces().catch(() => {});
        break;
      case "user.updated": {
        const patch = pickProfile(e.user);
        setMembers((ms) =>
          ms.some((m) => m.user_id === e.user.user_id)
            ? ms.map((m) => (m.user_id === e.user.user_id ? { ...m, ...patch, full_name: patch.full_name ?? m.full_name } : m))
            : ms,
        );
        if (e.user.user_id === meRef.current?.id) {
          setMe((u) => (u ? { ...u, ...patch, full_name: patch.full_name ?? u.full_name, avatar_url: patch.avatar_url === undefined ? u.avatar_url : patch.avatar_url } : u));
        }
        break;
      }
    }
    const extra = e as unknown as { type: string; workspace_id?: string; pref?: { channel_id?: string } };
    switch (extra.type) {
      case "channel_prefs.updated":
        // Another tab/device changed a channel's star/mute/section.
        if (channelsRef.current.some((c) => c.id === extra.pref?.channel_id)) loadSidebar(workspaceId);
        break;
      case "sidebar_sections.updated":
        // Deleting a section also moves its channels back to the default, so reload prefs too.
        if (extra.workspace_id === workspaceId) loadSidebar(workspaceId);
        break;
      case "groups.updated":
        refreshGroups(workspaceId);
        break;
      case "channels.read_all":
        // "Mark all as read" from another tab/device.
        if (extra.workspace_id !== workspaceId) break;
        setChannels((cs) => cs.map((c) => (c.unread_count ? { ...c, unread_count: 0 } : c)));
        break;
      case "scheduled.failed": {
        const sched = (e as unknown as { scheduled?: { error?: string | null } }).scheduled;
        toast.error(`A scheduled message couldn't be sent${sched?.error ? `: ${sched.error}` : ""}`);
        break;
      }
    }
    onProductivity(e);
    listeners.current.forEach((fn) => fn(e));
  });

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const markRead = useCallback((cid: string) => {
    setChannels((cs) => cs.map((c) => (c.id === cid && c.unread_count ? { ...c, unread_count: 0 } : c)));
    api(`/channels/${cid}/read`, { method: "POST" }).catch(() => {});
  }, []);

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, m])), [members]);
  useEffect(() => {
    membersRef.current = memberById;
  }, [memberById]);

  // "(3) Worklio" in the tab title, like desktop chat apps.
  const totalUnread = channels.reduce((n, c) => n + (c.is_member ? c.unread_count : 0), 0);
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name;
  useEffect(() => {
    document.title = `${totalUnread ? `(${totalUnread}) ` : ""}${workspaceName ?? "Worklio"} · Worklio`;
  }, [totalUnread, workspaceName]);

  const openDM = useCallback(
    async (userIds: string[]) => {
      const ch = await api<Channel>(`/workspaces/${workspaceId}/dms`, {
        method: "POST",
        body: JSON.stringify({ user_ids: userIds }),
      });
      await reloadChannels();
      router.push(`/w/${workspaceId}/c/${ch.id}`);
    },
    [workspaceId, reloadChannels, router],
  );

  const channelLabel = useCallback(
    (c: Channel) => {
      if (c.kind !== "dm") return c.name;
      const others = c.member_ids.filter((id) => id !== me?.id);
      if (!others.length) return `${me?.full_name ?? "You"} (you)`;
      return others.map((id) => memberById[id]?.full_name ?? "Unknown").join(", ");
    },
    [me, memberById],
  );

  const value: WorkspaceCtx = {
    workspaceId,
    activeChannelId: channelId,
    me,
    workspace: workspaces.find((w) => w.id === workspaceId),
    workspaces,
    channels,
    channelsLoaded: channelsLoadedFor === workspaceId,
    members,
    memberById,
    online,
    typing,
    isAdmin: ["owner", "admin"].includes(memberById[me?.id ?? ""]?.role ?? ""),
    reloadChannels,
    reloadMembers,
    reloadWorkspaces,
    markRead,
    channelLabel,
    sendTyping: (cid) => {
      sendTyping(cid);
    },
    sendRealtime: (frame) => sendRealtime(frame),
    connection,
    subscribe,
    sidebarOpen,
    setSidebarOpen,
    searchQuery,
    setSearchQuery,
    switcherOpen,
    setSwitcherOpen,
    openDM,
    profileOpen,
    setProfileOpen,
    setMe,
    preferencesOpen,
    setPreferencesOpen,
    focusMode,
    setFocusMode,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
