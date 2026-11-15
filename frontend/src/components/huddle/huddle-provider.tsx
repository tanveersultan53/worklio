"use client";

import { DisconnectReason, getLogger, LoggerNames, LogLevel, Room, RoomEvent, setLogLevel } from "livekit-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type {
  CallInvite,
  CallInviteUpdatedEvent,
  CallJoin,
  CallJoinResponse,
  CallKind,
  CallOut,
  CallUpdatedEvent,
} from "@/components/calls/types";
import { playJoinKnock, playLeaveTone } from "@/components/calls/tones";
import { isCallLive } from "@/components/calls/types";
import { enableCameraWithEffects } from "@/components/effects/engine";
import { DesktopAnnotationBridge } from "@/components/annotate/desktop-overlay-bridge";
import { CameraEffectsSync } from "@/components/effects/sync";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { api, API_URL, auth, type Channel } from "@/lib/api";
import { errorMessage, toast } from "@/lib/toast";

import { DEFAULT_MEDIA, type MediaChoice, PreJoinDialog, type PreJoinMode, type PreJoinRequest, preJoinSkip } from "./pre-join";
import { HuddleRoomStore, IDLE_STORE, isUserCancelled, mediaErrorMessage } from "./room-store";
import type { HuddleInfo, HuddleRoomSnapshot, HuddleStatus, HuddleUpdatedEvent } from "./types";

/**
 * LiveKit data topic: "this call is moving to `channelId`". Sent by whoever adds someone from
 * outside a DM; everyone else in the room follows into the new group DM's call.
 */
const TOPIC_MOVE = "move";
const moveCodec = { enc: new TextEncoder(), dec: new TextDecoder() };
/** How long a follower waits for the new call to show up before joining anyway. */
const MOVE_WAIT_MS = 12_000;

// --- LiveKit logging ---
// LiveKit logs routine teardown chatter ("could not createOffer with closed peer connection",
// data-channel closes) through console.warn/error, which pops the Next dev "Issue" overlay. Keep
// only real errors, and drop the one error that's benign: the client opens a DATA_TRACK_LOSSY
// channel we never use, and servers that don't know it close it straight away.
const BENIGN_LOGS = [/data channel 'DATA_TRACK_LOSSY' closed unexpectedly/, /closed peer connection/];
const LOG_FLAG = "__worklioLivekitLogs";

function configureLivekitLogging() {
  const g = globalThis as typeof globalThis & { [LOG_FLAG]?: true };
  if (g[LOG_FLAG]) return; // once per page, even across hot reloads
  g[LOG_FLAG] = true;
  for (const name of [LoggerNames.Engine, LoggerNames.PCTransport, LoggerNames.PCManager, LoggerNames.Room]) {
    const logger = getLogger(name);
    const factory = logger.methodFactory;
    logger.methodFactory = (methodName, level, loggerName) => {
      const raw = factory(methodName, level, loggerName);
      return (...args: unknown[]) => {
        const msg = args[0];
        if (typeof msg === "string" && BENIGN_LOGS.some((re) => re.test(msg))) return;
        raw(...args);
      };
    };
  }
  // Rebuilds every logger's methods through the factories above.
  setLogLevel(LogLevel.error);
}

configureLivekitLogging();

// --- Clean disconnects ---
// Disconnecting is async (unpublish, close PCs, send leave). Starting a new connection while the
// old one is still tearing down makes LiveKit renegotiate on a closed peer connection, so every
// teardown goes through here and `connect` waits for pending ones first.
const pendingDisconnects = new Set<Promise<void>>();

function closeRoom(room: Room, store?: HuddleRoomStore | null): Promise<void> {
  store?.dispose();
  const done = room
    .disconnect(true)
    .catch(() => {})
    .finally(() => {
      room.removeAllListeners();
      pendingDisconnects.delete(done);
    });
  pendingDisconnects.add(done);
  return done;
}

/** Waits (at most `ms`) for rooms that are still disconnecting. */
async function settleDisconnects(ms = 3000) {
  if (!pendingDisconnects.size) return;
  await Promise.race([Promise.allSettled([...pendingDisconnects]), new Promise((r) => setTimeout(r, ms))]);
}

const HEARTBEAT_MS = 20_000;
const EMPTY_MAP: Record<string, HuddleInfo> = {};
const EMPTY_CALLS: Record<string, CallOut> = {};
const EMPTY_INVITES: CallInvite[] = [];
/** HD at 30 fps (24 fps looked choppy next to other call apps). */
const CAMERA_OPTS = { resolution: { width: 1280, height: 720, frameRate: 30 } };
/**
 * What we send. The top layer gets more room than LiveKit's 1.7 Mbps default so faces stay sharp;
 * dynacast still pauses layers nobody watches. Screen shares go out at 1080p, tuned for text.
 */
const PUBLISH_DEFAULTS = {
  simulcast: true,
  videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 30 },
  screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 15 },
  dtx: true,
  red: true,
};
/** Join/leave cues stay quiet this long after (re)connecting, so the initial roster never chimes. */
const ROSTER_SETTLE_MS = 1500;
/** Beyond this many people, "X joined" toasts become noise (the sound still plays). */
const JOIN_TOAST_MAX_PEOPLE = 12;
let preJoinSeq = 0;

type Session = {
  /** "" only while accepting a call whose channel we don't know yet. */
  channelId: string;
  status: HuddleStatus;
  /** null while the join request / LiveKit connect is in flight. */
  store: HuddleRoomStore | null;
  /** Local fallback for the elapsed timer when the server hasn't told us `started_at` yet. */
  joinedAt: number;
  /** The call this session belongs to, once known (from the join response or a `call.updated`). */
  call: CallOut | null;
  kind: CallKind;
};

/** A call of mine that the server ended before anyone picked up (for the outgoing overlay's last word). */
export type EndedCall = { call: CallOut; at: number };

type HuddleCtx = {
  /** Live huddles in this workspace, keyed by channel id (only non-empty ones). */
  huddles: Record<string, HuddleInfo>;
  /** Live (ringing/active) calls seen over realtime, keyed by channel id. */
  calls: Record<string, CallOut>;
  /** Channel whose huddle I'm in (or joining), else null. */
  activeChannelId: string | null;
  status: HuddleStatus | null;
  joinedAt: number | null;
  room: Room | null;
  store: HuddleRoomStore | null;
  /** The call I'm in, once known. */
  call: CallOut | null;
  /** `call.invites`, or a stable empty list. */
  invites: CallInvite[];
  /** Kind of the session I'm in ("audio" for plain huddles). */
  callKind: CallKind | null;
  /** Last call of mine that ended unanswered / declined / cancelled. */
  endedCall: EndedCall | null;
  clearEndedCall: () => void;
  /**
   * Join (or start) the channel's huddle without ringing anyone. With `video`, the
   * "Ready to join?" camera check runs first (unless the user opted out).
   */
  join: (channelId: string, opts?: { video?: boolean }) => Promise<void>;
  /** Start (or join) a call in a channel, ringing `inviteeIds` (DMs default to everyone else). */
  startCall: (channelId: string, kind: CallKind, inviteeIds?: string[]) => Promise<void>;
  /**
   * Pick up a call that's ringing for me. Resolves false only when the user backed out of the
   * "Ready to join?" check (so the caller can put the ring back).
   */
  acceptCall: (callId: string, withVideo: boolean, channelId?: string) => Promise<boolean>;
  /** Stop ringing everyone I invited; hangs up when nobody else ever joined. */
  cancelRinging: () => Promise<void>;
  /** Ring more people into the call I'm in. */
  inviteToCall: (userIds: string[]) => Promise<void>;
  leave: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  /** Resume audio playback after the browser blocked autoplay. Call from a click handler. */
  startAudio: () => Promise<void>;
  /** Whether the expanded (grid) view is open. */
  expanded: boolean;
  setExpanded: (open: boolean) => void;
};

const Ctx = createContext<HuddleCtx | null>(null);

export function useHuddles(): HuddleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHuddles must be used inside <HuddleProvider>");
  return ctx;
}

/** Live LiveKit room state (participants, speakers, my mic/camera). Stable when idle. */
export function useHuddleRoom(): HuddleRoomSnapshot {
  const { store } = useHuddles();
  const s = store ?? IDLE_STORE;
  return useSyncExternalStore(s.subscribe, s.getSnapshot, IDLE_STORE.getSnapshot);
}

function leavePath(channelId: string, callId: string | null | undefined) {
  return callId ? `/calls/${callId}/leave` : `/channels/${channelId}/huddle/leave`;
}

function postLeave(channelId: string, callId?: string | null) {
  if (!channelId && !callId) return Promise.resolve();
  return api(leavePath(channelId, callId), { method: "POST" }).catch(() => {
    // Older backend without /calls: fall back to the huddle endpoint.
    if (callId && channelId) return api(`/channels/${channelId}/huddle/leave`, { method: "POST" }).catch(() => {});
  });
}

/** Fire-and-forget leave that survives page unload. */
function beaconLeave(channelId: string, callId: string | null | undefined) {
  if (!channelId && !callId) return;
  const token = auth.get();
  try {
    void fetch(`${API_URL}${leavePath(channelId, callId)}`, {
      method: "POST",
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
  } catch {
    // ignore: the server prunes us after 60 s without a heartbeat anyway
  }
}

const othersIn = (ids: string[], me: string | undefined) => ids.some((id) => id !== me);

export function HuddleProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId, me, channels, memberById, reloadChannels } = useWorkspace();

  const [huddleState, setHuddleState] = useState<{ workspaceId: string; map: Record<string, HuddleInfo> }>({
    workspaceId: "",
    map: {},
  });
  const [callState, setCallState] = useState<{ workspaceId: string; map: Record<string, CallOut> }>({
    workspaceId: "",
    map: {},
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [endedCall, setEndedCall] = useState<EndedCall | null>(null);
  const [preJoin, setPreJoin] = useState<PreJoinRequest | null>(null);

  // Mirrors of state for async flows / event listeners. Written only in callbacks / effects.
  const sessionRef = useRef<Session | null>(null);
  const meIdRef = useRef<string | undefined>(undefined);
  const dmChannelsRef = useRef<Set<string>>(new Set());
  const namesRef = useRef<Record<string, { full_name: string }>>({});
  /** Bumped on every join/leave so stale async join steps and Disconnected events can bail. */
  const seqRef = useRef(0);
  /** The room being connected right now (not yet in the session), so leaving can abort it. */
  const connectingRoomRef = useRef<Room | null>(null);
  /** The pending "Ready to join?" check, if any. */
  const preJoinRef = useRef<PreJoinRequest | null>(null);
  /** Follow someone who moved this call to a group DM (set below, once `connect` exists). */
  const followMoveRef = useRef<((channelId: string, fromId: string, video: boolean) => void) | null>(null);
  /** startCall, for re-entering it with the group DM it just opened. */
  const startCallRef = useRef<((channelId: string, kind: CallKind, inviteeIds?: string[]) => Promise<void>) | null>(null);

  useEffect(() => {
    meIdRef.current = me?.id;
    dmChannelsRef.current = new Set(channels.filter((c) => c.kind === "dm").map((c) => c.id));
    namesRef.current = memberById;
  });

  const commit = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // --- Active huddles in this workspace ---
  useEffect(() => {
    let cancelled = false;
    api<HuddleInfo[]>(`/workspaces/${workspaceId}/huddles`)
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, HuddleInfo> = {};
        for (const h of list) if (h.participant_ids.length) map[h.channel_id] = h;
        setHuddleState({ workspaceId, map });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, reloadKey]);

  // --- Leaving ---
  /** Leave the call. `keepWindow` (moving to another call) leaves the call window open. */
  const leave = useCallback((opts?: { keepWindow?: boolean }) => {
    const cur = sessionRef.current;
    if (!cur) return;
    seqRef.current++;
    commit(null);
    if (opts?.keepWindow !== true) setExpanded(false);
    if (cur.store) void closeRoom(cur.store.room, cur.store);
    const pending = connectingRoomRef.current;
    connectingRoomRef.current = null;
    if (pending && pending !== cur.store?.room) void closeRoom(pending);
    void postLeave(cur.channelId, cur.call?.id);
  }, [commit]);

  // --- Realtime ---
  useWorkspaceEvents((e) => {
    const ev = e as unknown as { type: string };
    switch (ev.type) {
      case "resync":
        setReloadKey((k) => k + 1);
        return;
      case "huddle.updated": {
        const { channel_id, participant_ids, started_at } = ev as HuddleUpdatedEvent;
        setHuddleState((s) => {
          const map = { ...s.map };
          if (participant_ids.length) map[channel_id] = { channel_id, participant_ids, started_at };
          else delete map[channel_id];
          return { ...s, map };
        });
        return;
      }
      case "call.updated": {
        const { call } = ev as CallUpdatedEvent;
        if (call.workspace_id && call.workspace_id !== workspaceId) return;
        setCallState((s) => {
          const map = s.workspaceId === workspaceId ? { ...s.map } : {};
          if (isCallLive(call)) map[call.channel_id] = call;
          else if (map[call.channel_id]?.id === call.id) delete map[call.channel_id];
          return { workspaceId, map };
        });
        const cur = sessionRef.current;
        if (!cur) return;
        const mine = cur.call?.id === call.id;
        // A plain huddle join learns its call from the first live update in that channel.
        const adopt = !cur.call && cur.channelId === call.channel_id && isCallLive(call);
        if (!mine && !adopt) return;
        if (isCallLive(call)) {
          commit({ ...cur, call, kind: call.kind });
          return;
        }
        // The server ended my call (no answer / declined / cancelled / everyone left).
        const meId = meIdRef.current;
        if (call.started_by === meId && call.status !== "ended") setEndedCall({ call, at: Date.now() });
        leave();
        return;
      }
      case "call.invite_updated": {
        const { call_id, user_id, status } = ev as CallInviteUpdatedEvent;
        const cur = sessionRef.current;
        if (!cur?.call || cur.call.id !== call_id) return;
        const call = cur.call;
        const exists = call.invites.some((i) => i.user_id === user_id);
        const invites = exists
          ? call.invites.map((i) => (i.user_id === user_id ? { ...i, status } : i))
          : [...call.invites, { user_id, status, invited_by: meIdRef.current ?? "" }];
        commit({ ...cur, call: { ...call, invites } });
        if (status !== "declined" && status !== "missed") return;
        // In a DM the outgoing overlay announces the outcome when the whole call ends.
        const meId = meIdRef.current;
        const stillRinging = invites.some((i) => i.status === "ringing");
        const anyoneElse = othersIn(call.joined_ids, meId) || othersIn(call.participant_ids, meId);
        if (dmChannelsRef.current.has(call.channel_id) && !stillRinging && !anyoneElse) return;
        const name = namesRef.current[user_id]?.full_name.split(" ")[0] ?? "They";
        toast.info(status === "declined" ? `${name} declined the call.` : `${name} didn't answer.`);
        return;
      }
    }
  });

  const huddles = huddleState.workspaceId === workspaceId ? huddleState.map : EMPTY_MAP;
  const calls = callState.workspaceId === workspaceId ? callState.map : EMPTY_CALLS;
  /** Channels with a call/huddle in progress right now. */
  const liveChannelsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    liveChannelsRef.current = new Set([...Object.keys(huddles), ...Object.keys(calls)]);
  }, [huddles, calls]);

  // --- Connecting (shared by join / startCall / acceptCall) ---
  const connect = useCallback(
    async (
      channelHint: string,
      kind: CallKind,
      request: () => Promise<{ join: CallJoin; call: CallOut | null }>,
      opts: { video: boolean; failure: string; media?: MediaChoice; keepWindow?: boolean },
    ) => {
      const media = opts.media ?? DEFAULT_MEDIA;
      if (sessionRef.current) leave({ keepWindow: opts.keepWindow });

      const seq = ++seqRef.current;
      commit({ channelId: channelHint, status: "connecting", store: null, joinedAt: Date.now(), call: null, kind });

      let joined: { channelId: string; callId: string | null } | null = null;
      let store: HuddleRoomStore | null = null;
      try {
        const res = await request();
        const channelId = res.call?.channel_id ?? channelHint;
        joined = { channelId, callId: res.call?.id ?? null };
        if (seq !== seqRef.current) {
          void postLeave(channelId, res.call?.id);
          return;
        }
        commit({
          channelId,
          status: "connecting",
          store: null,
          joinedAt: Date.now(),
          call: res.call,
          kind: res.call?.kind ?? kind,
        });

        const room = new Room({
          // "screen": size requests by real device pixels, so Retina/HiDPI screens get HD layers
          // instead of the half-resolution ones a CSS-pixel measure picks.
          adaptiveStream: { pixelDensity: "screen" },
          dynacast: true,
          publishDefaults: PUBLISH_DEFAULTS,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(media.audioDeviceId ? { deviceId: media.audioDeviceId } : null),
          },
          videoCaptureDefaults: { ...CAMERA_OPTS, ...(media.videoDeviceId ? { deviceId: media.videoDeviceId } : null) },
          ...(media.speakerDeviceId ? { audioOutput: { deviceId: media.speakerDeviceId } } : null),
        });
        const roomStore = new HuddleRoomStore(room);
        store = roomStore;
        connectingRoomRef.current = room;

        room.on(RoomEvent.Reconnecting, () => {
          const s = sessionRef.current;
          if (seq === seqRef.current && s) commit({ ...s, status: "reconnecting" });
        });
        // Join / leave cues for people arriving after me (never for me or the roster I joined into).
        let quietUntil = Number.POSITIVE_INFINITY;
        room.on(RoomEvent.Reconnecting, () => {
          quietUntil = Number.POSITIVE_INFINITY;
        });
        room.on(RoomEvent.ParticipantConnected, (p) => {
          if (seq !== seqRef.current || Date.now() < quietUntil || p.identity === meIdRef.current) return;
          playJoinKnock();
          if (room.remoteParticipants.size < JOIN_TOAST_MAX_PEOPLE) {
            const name = namesRef.current[p.identity]?.full_name || p.name || "Someone";
            toast.info(`${name} joined`);
          }
        });
        room.on(RoomEvent.ParticipantDisconnected, (p) => {
          if (seq !== seqRef.current || Date.now() < quietUntil || p.identity === meIdRef.current) return;
          playLeaveTone();
        });
        room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (topic !== TOPIC_MOVE || seq !== seqRef.current || !participant) return;
          try {
            const msg = JSON.parse(moveCodec.dec.decode(payload)) as { channelId?: unknown };
            if (typeof msg.channelId === "string") {
              followMoveRef.current?.(msg.channelId, participant.identity, room.localParticipant.isCameraEnabled);
            }
          } catch {
            // Not a move message.
          }
        });
        room.on(RoomEvent.Reconnected, () => {
          quietUntil = Date.now() + ROSTER_SETTLE_MS;
          const s = sessionRef.current;
          if (seq === seqRef.current && s) commit({ ...s, status: "connected" });
        });
        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (seq !== seqRef.current) return; // we left on purpose
          const s = sessionRef.current;
          seqRef.current++;
          if (connectingRoomRef.current === room) connectingRoomRef.current = null;
          void closeRoom(room, roomStore);
          commit(null);
          setExpanded(false);
          void postLeave(channelId, s?.call?.id ?? res.call?.id);
          if (reason === DisconnectReason.DUPLICATE_IDENTITY) toast.info("You joined this call from another tab.");
          else if (reason !== DisconnectReason.CLIENT_INITIATED) toast.error("You were disconnected from the call.");
        });

        // Let a previous room finish tearing down before opening new peer connections.
        await settleDisconnects();
        if (seq !== seqRef.current) {
          void closeRoom(room, roomStore);
          return;
        }
        await room.connect(res.join.url, res.join.token);
        quietUntil = Date.now() + ROSTER_SETTLE_MS;
        if (connectingRoomRef.current === room) connectingRoomRef.current = null;
        if (seq !== seqRef.current) {
          void closeRoom(room, roomStore);
          return;
        }
        const s = sessionRef.current;
        commit({ ...(s ?? { channelId, call: res.call, kind }), status: "connected", store: roomStore, joinedAt: Date.now() });
        // We're inside the click's async continuation; most browsers still allow this.
        room.startAudio().catch(() => {});

        if (media.micEnabled) {
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (err) {
            if (seq === seqRef.current) toast.error(`${mediaErrorMessage(err, "microphone")} You joined muted.`);
          }
        }
        if (opts.video && media.cameraEnabled && seq === seqRef.current) {
          try {
            const cameraOpts = media.videoDeviceId ? { ...CAMERA_OPTS, deviceId: media.videoDeviceId } : CAMERA_OPTS;
            await enableCameraWithEffects(room, cameraOpts, meIdRef.current);
            if (seq === seqRef.current) setExpanded(true);
          } catch (err) {
            if (seq === seqRef.current) toast.error(`${mediaErrorMessage(err, "camera")} You joined with your camera off.`);
          }
        }
      } catch (err) {
        if (store && connectingRoomRef.current === store.room) connectingRoomRef.current = null;
        if (seq !== seqRef.current) {
          if (store) void closeRoom(store.room, store);
          return;
        }
        seqRef.current++;
        if (store) void closeRoom(store.room, store);
        commit(null);
        if (joined) void postLeave(joined.channelId, joined.callId);
        toast.error(errorMessage(err, opts.failure));
      }
    },
    [commit, leave],
  );

  // --- "Ready to join?" camera check before video joins ---
  /** Resolves with the user's devices/toggles, or null if they backed out. Skipped when opted out. */
  const askPreJoin = useCallback((channelId: string, mode: PreJoinMode, callKind: CallKind): Promise<MediaChoice | null> => {
    if (preJoinSkip.getSnapshot()) return Promise.resolve(DEFAULT_MEDIA);
    return new Promise<MediaChoice | null>((resolve) => {
      preJoinRef.current?.resolve(null);
      const req: PreJoinRequest = {
        id: ++preJoinSeq,
        channelId,
        mode,
        callKind,
        resolve: (choice) => {
          if (preJoinRef.current === req) {
            preJoinRef.current = null;
            setPreJoin(null);
          }
          resolve(choice);
        },
      };
      preJoinRef.current = req;
      setPreJoin(req);
    });
  }, []);

  // A pending check never outlives the workspace it was opened in.
  useEffect(() => () => preJoinRef.current?.resolve(null), [workspaceId]);

  // --- Joining a huddle (no ringing) ---
  const join = useCallback(
    async (channelId: string, joinOpts?: { video?: boolean }) => {
      if (sessionRef.current?.channelId === channelId) return;
      const video = !!joinOpts?.video;
      let media: MediaChoice | undefined;
      if (video) {
        const choice = await askPreJoin(channelId, "join", "video");
        if (!choice) return;
        media = choice;
      }
      await connect(
        channelId,
        "audio",
        async () => ({
          join: await api<CallJoin>(`/channels/${channelId}/huddle/join`, { method: "POST" }),
          call: null,
        }),
        { video, media, failure: "Couldn't join the huddle" },
      );
    },
    [connect, askPreJoin],
  );

  // --- Calls ---

  /**
   * Adding people who aren't in a DM: open (or reuse) the group DM with everyone, the way Slack
   * turns a 1:1 huddle into a group one. Returns null when everyone is already in the DM.
   */
  const groupDmFor = useCallback(
    async (channelId: string, extraIds: string[], alsoIds: string[] = []): Promise<Channel | null> => {
      if (!dmChannelsRef.current.has(channelId)) return null;
      const memberIds = await api<string[]>(`/channels/${channelId}/members`);
      if (extraIds.every((id) => memberIds.includes(id))) return null;
      const everyone = [...new Set([...memberIds, ...alsoIds, ...extraIds])].filter((id) => id !== meIdRef.current);
      const dm = await api<Channel>(`/workspaces/${workspaceId}/dms`, {
        method: "POST",
        body: JSON.stringify({ user_ids: everyone }),
      });
      await reloadChannels().catch(() => {});
      return dm;
    },
    [workspaceId, reloadChannels],
  );

  /** Move my live DM call to `dm`: tell the room to follow, then start the call there ringing `ring`. */
  const moveCallTo = useCallback(
    async (cur: Session, dm: Channel, ring: string[]) => {
      const room = cur.store?.room;
      const video = room?.localParticipant.isCameraEnabled ?? cur.kind === "video";
      if (room) {
        await room.localParticipant
          .publishData(moveCodec.enc.encode(JSON.stringify({ channelId: dm.id })), { reliable: true, topic: TOPIC_MOVE })
          .catch(() => {});
      }
      await connect(
        dm.id,
        cur.kind,
        () =>
          api<CallJoinResponse>(`/channels/${dm.id}/calls`, {
            method: "POST",
            body: JSON.stringify({ kind: cur.kind, invitee_ids: ring }),
          }),
        { video, failure: "Couldn't move the call to a group conversation", keepWindow: true },
      );
    },
    [connect],
  );

  // Someone in my call added people from outside our DM: follow them into the group DM's call.
  useEffect(() => {
    followMoveRef.current = (channelId, fromId, video) => {
      const name = namesRef.current[fromId]?.full_name ?? "Someone";
      toast.info(`${name} added people. Moving you to the group call…`);
      void (async () => {
        await reloadChannels().catch(() => {});
        const until = Date.now() + MOVE_WAIT_MS;
        while (!liveChannelsRef.current.has(channelId) && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 300));
        }
        if (sessionRef.current?.channelId === channelId) return;
        await connect(
          channelId,
          "audio",
          async () => ({
            join: await api<CallJoin>(`/channels/${channelId}/huddle/join`, { method: "POST" }),
            call: null,
          }),
          { video, failure: "Couldn't join the group call", keepWindow: true },
        );
      })();
    };
  }, [connect, reloadChannels]);

  const inviteToCall = useCallback(
    async (userIds: string[]) => {
      const cur = sessionRef.current;
      const ids = userIds.filter((id) => id !== meIdRef.current);
      if (!ids.length) return;
      if (!cur?.call && !cur?.store) {
        toast.error("Join the call first, then invite people.");
        return;
      }
      try {
        const present = cur.store ? [...cur.store.room.remoteParticipants.keys()] : [];
        const dm = await groupDmFor(cur.channelId, ids, present);
        if (dm) {
          const others = await api<string[]>(`/channels/${dm.id}/members`);
          // Ring the new people and anyone from the DM who isn't here; the rest follow the move.
          const ring = others.filter((id) => id !== meIdRef.current && !present.includes(id));
          await moveCallTo(cur, dm, ring);
          return;
        }
        if (!cur.call) {
          toast.error("Join the call first, then invite people.");
          return;
        }
        const call = await api<CallOut>(`/calls/${cur.call.id}/invite`, {
          method: "POST",
          body: JSON.stringify({ user_ids: ids }),
        });
        const s = sessionRef.current;
        if (s?.call?.id === call.id) commit({ ...s, call });
      } catch (err) {
        toast.error(errorMessage(err, "Couldn't ring them"));
      }
    },
    [commit, groupDmFor, moveCallTo],
  );

  const startCall = useCallback(
    async (channelId: string, kind: CallKind, inviteeIds?: string[]) => {
      const cur = sessionRef.current;
      if (cur?.channelId === channelId) {
        // Already here: ring the new people and turn the camera on for a video call.
        if (inviteeIds?.length) await inviteToCall(inviteeIds);
        const curRoom = cur.store?.room;
        if (kind === "video" && curRoom && !curRoom.localParticipant.isCameraEnabled) {
          try {
            await enableCameraWithEffects(curRoom, CAMERA_OPTS, meIdRef.current);
          } catch (err) {
            toast.error(mediaErrorMessage(err, "camera"));
          }
        }
        return;
      }
      // Ringing people from outside a DM: start the call in the group DM with all of them instead.
      if (inviteeIds?.length) {
        try {
          const dm = await groupDmFor(channelId, inviteeIds.filter((id) => id !== meIdRef.current));
          if (dm) {
            const others = await api<string[]>(`/channels/${dm.id}/members`);
            return await startCallRef.current?.(dm.id, kind, others.filter((id) => id !== meIdRef.current));
          }
        } catch (err) {
          toast.error(errorMessage(err, "Couldn't start the call"));
          return;
        }
      }
      let media: MediaChoice | undefined;
      if (kind === "video") {
        const choice = await askPreJoin(channelId, "start", kind);
        if (!choice) return;
        media = choice;
      }
      // Joining a call that's already running: don't re-ring anyone (POST /calls would default
      // a DM's invitees to everyone again), just take the huddle path.
      if (!inviteeIds?.length && liveChannelsRef.current.has(channelId)) {
        await connect(
          channelId,
          kind,
          async () => ({
            join: await api<CallJoin>(`/channels/${channelId}/huddle/join`, { method: "POST" }),
            call: null,
          }),
          { video: kind === "video", media, failure: "Couldn't join the call" },
        );
        return;
      }
      const body: { kind: CallKind; invitee_ids?: string[] } = { kind };
      if (inviteeIds) body.invitee_ids = inviteeIds.filter((id) => id !== meIdRef.current);
      await connect(
        channelId,
        kind,
        () => api<CallJoinResponse>(`/channels/${channelId}/calls`, { method: "POST", body: JSON.stringify(body) }),
        { video: kind === "video", media, failure: "Couldn't start the call" },
      );
    },
    [connect, inviteToCall, askPreJoin, groupDmFor],
  );
  useEffect(() => {
    startCallRef.current = startCall;
  }, [startCall]);

  const acceptCall = useCallback(
    async (callId: string, withVideo: boolean, channelId?: string) => {
      if (sessionRef.current?.call?.id === callId) return true;
      let media: MediaChoice | undefined;
      if (withVideo) {
        const choice = await askPreJoin(channelId ?? "", "accept", "video");
        if (!choice) return false;
        media = choice;
      }
      await connect(
        channelId ?? "",
        withVideo ? "video" : "audio",
        () => api<CallJoinResponse>(`/calls/${callId}/accept`, { method: "POST" }),
        { video: withVideo, media, failure: "Couldn't join the call" },
      );
      return true;
    },
    [connect, askPreJoin],
  );

  const cancelRinging = useCallback(async () => {
    const cur = sessionRef.current;
    if (!cur?.call) return;
    const call = cur.call;
    const meId = meIdRef.current;
    const alone = !othersIn(call.joined_ids, meId) && !othersIn(call.participant_ids, meId);
    try {
      await api(`/calls/${call.id}/cancel`, { method: "POST" });
    } catch (err) {
      if (!alone) toast.error(errorMessage(err, "Couldn't stop ringing"));
    }
    const s = sessionRef.current;
    if (s?.call?.id === call.id) {
      const invites = s.call.invites.map((i) => (i.status === "ringing" ? { ...i, status: "cancelled" as const } : i));
      commit({ ...s, call: { ...s.call, invites } });
    }
    if (alone) leave();
  }, [commit, leave]);

  const clearEndedCall = useCallback(() => setEndedCall(null), []);

  // --- Media toggles ---
  const toggleMic = useCallback(async () => {
    const room = sessionRef.current?.store?.room;
    if (!room) return;
    const lp = room.localParticipant;
    try {
      await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
    } catch (err) {
      toast.error(mediaErrorMessage(err, "microphone"));
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    const room = sessionRef.current?.store?.room;
    if (!room) return;
    const lp = room.localParticipant;
    try {
      if (lp.isCameraEnabled) await lp.setCameraEnabled(false);
      else await enableCameraWithEffects(room, CAMERA_OPTS, meIdRef.current);
    } catch (err) {
      toast.error(mediaErrorMessage(err, "camera"));
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const room = sessionRef.current?.store?.room;
    if (!room) return;
    const lp = room.localParticipant;
    if (!lp.isScreenShareEnabled && typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      toast.error("Screen sharing isn't supported on this device.");
      return;
    }
    try {
      await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true, selfBrowserSurface: "exclude" });
    } catch (err) {
      if (!isUserCancelled(err)) toast.error(mediaErrorMessage(err, "screen"));
    }
  }, []);

  const startAudio = useCallback(async () => {
    await sessionRef.current?.store?.room.startAudio().catch(() => {});
  }, []);

  // --- Heartbeat while connected ---
  const heartbeatChannel = session && session.status !== "connecting" ? session.channelId : null;
  useEffect(() => {
    if (!heartbeatChannel) return;
    const id = window.setInterval(() => {
      api(`/channels/${heartbeatChannel}/huddle/heartbeat`, { method: "POST" }).catch(() => {});
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [heartbeatChannel]);

  // --- Leave on page unload / hide (bfcache, mobile tab kill) ---
  useEffect(() => {
    const onUnload = () => {
      const cur = sessionRef.current;
      if (!cur) return;
      seqRef.current++;
      beaconLeave(cur.channelId, cur.call?.id);
      if (cur.store) void closeRoom(cur.store.room, cur.store);
      const pending = connectingRoomRef.current;
      connectingRoomRef.current = null;
      if (pending && pending !== cur.store?.room) void closeRoom(pending);
      sessionRef.current = null;
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  // A page restored from bfcache after `pagehide` must not think it's still in the huddle.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (!sessionRef.current) setSession(null);
      setReloadKey((k) => k + 1);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // --- Leave when switching workspace or unmounting the shell ---
  useEffect(() => () => leave(), [workspaceId, leave]);

  const call = session?.call ?? null;
  const value = useMemo<HuddleCtx>(
    () => ({
      huddles,
      calls,
      activeChannelId: session?.channelId || null,
      status: session?.status ?? null,
      joinedAt: session?.joinedAt ?? null,
      room: session?.store?.room ?? null,
      store: session?.store ?? null,
      call,
      invites: call?.invites ?? EMPTY_INVITES,
      callKind: session?.kind ?? null,
      endedCall,
      clearEndedCall,
      join,
      startCall,
      acceptCall,
      cancelRinging,
      inviteToCall,
      leave,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      startAudio,
      expanded,
      setExpanded,
    }),
    [
      huddles,
      calls,
      session,
      call,
      endedCall,
      clearEndedCall,
      join,
      startCall,
      acceptCall,
      cancelRinging,
      inviteToCall,
      leave,
      toggleMic,
      toggleCamera,
      toggleScreenShare,
      startAudio,
      expanded,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <CameraEffectsSync room={session?.store?.room ?? null} userId={me?.id} />
      <DesktopAnnotationBridge room={session?.store?.room ?? null} />
      <PreJoinDialog request={preJoin} />
    </Ctx.Provider>
  );
}
