"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useHuddles } from "@/components/huddle/huddle-provider";
import { MeetingStartingAlert } from "@/components/meetings/meeting-alert";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { api } from "@/lib/api";
import { bringToFront, isAway } from "@/lib/desktop";

import { CallStyles, channelContext, firstName, ringingInvites, useTimedOut } from "./call-styles";
import { IncomingCall } from "./incoming-call";
import { HuddleBanner } from "./huddle-banner";
import { OutgoingCall } from "./outgoing-call";
import { callSoundMute, installUnlock, tones } from "./tones";
import type { CallRingStoppedEvent, CallRingingEvent, CallUpdatedEvent, RingingCall } from "./types";
import { isCallLive } from "./types";

/** Server rings for 40 s; drop our copy a little later in case `call.ring_stopped` got lost. */
const LOCAL_RING_TTL_MS = 45_000;

export type IncomingRing = RingingCall & { receivedAt: number };

type CallsCtx = {
  /** Calls ringing for me in this workspace, oldest first. The first one is shown. */
  incoming: IncomingRing[];
  accept: (callId: string, withVideo: boolean) => Promise<void>;
  decline: (callId: string) => Promise<void>;
  /** Mutes the ringtone and ring-back on this device. */
  soundsMuted: boolean;
  setSoundsMuted: (muted: boolean) => void;
};

const Ctx = createContext<CallsCtx | null>(null);

export function useCalls(): CallsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCalls must be used inside <CallProvider>");
  return ctx;
}

/**
 * Call signalling UI: incoming rings (modal + ringtone + desktop notification + title flash)
 * and the caller's ring-back / outgoing overlay. Mount inside <HuddleProvider>.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { workspaceId, me, memberById, channels } = useWorkspace();
  const { acceptCall, call: myCall, status: myStatus } = useHuddles();
  const router = useRouter();

  const [ringState, setRingState] = useState<{ workspaceId: string; list: IncomingRing[] }>({
    workspaceId: "",
    list: [],
  });
  const [reloadKey, setReloadKey] = useState(0);
  const soundsMuted = useSyncExternalStore(
    callSoundMute.subscribe,
    callSoundMute.getSnapshot,
    callSoundMute.getServerSnapshot,
  );

  const meIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    meIdRef.current = me?.id;
  });

  const incoming = useMemo(
    () => (ringState.workspaceId === workspaceId ? ringState.list : []),
    [ringState, workspaceId],
  );

  const upsert = useCallback(
    (entries: RingingCall[], replace = false) => {
      const now = Date.now();
      setRingState((s) => {
        const base = s.workspaceId === workspaceId && !replace ? s.list : [];
        const list = [...base];
        for (const e of entries) {
          if (e.call.workspace_id !== workspaceId) continue;
          const i = list.findIndex((x) => x.call.id === e.call.id);
          if (i >= 0) list[i] = { ...list[i], ...e };
          else list.push({ ...e, receivedAt: now });
        }
        return { workspaceId, list };
      });
    },
    [workspaceId],
  );

  const remove = useCallback((callId: string) => {
    setRingState((s) => {
      if (!s.list.some((x) => x.call.id === callId)) return s;
      return { ...s, list: s.list.filter((x) => x.call.id !== callId) };
    });
  }, []);

  // --- Calls already ringing when the page loads (and after a reconnect) ---
  useEffect(() => {
    let cancelled = false;
    api<RingingCall[]>("/me/calls/ringing")
      .then((list) => {
        if (!cancelled) upsert(list, true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [upsert, reloadKey]);

  useWorkspaceEvents((e) => {
    const ev = e as unknown as { type: string };
    switch (ev.type) {
      case "resync":
        setReloadKey((k) => k + 1);
        return;
      case "call.ringing": {
        const { call, caller_id } = ev as CallRingingEvent;
        if (caller_id === meIdRef.current) return;
        upsert([{ call, caller_id }]);
        return;
      }
      case "call.ring_stopped":
        remove((ev as CallRingStoppedEvent).call_id);
        return;
      case "call.updated": {
        const { call } = ev as CallUpdatedEvent;
        const meId = meIdRef.current;
        const mine = call.invites.find((i) => i.user_id === meId);
        if (!isCallLive(call) || (mine && mine.status !== "ringing")) remove(call.id);
        else
          setRingState((s) =>
            s.list.some((x) => x.call.id === call.id)
              ? { ...s, list: s.list.map((x) => (x.call.id === call.id ? { ...x, call } : x)) }
              : s,
          );
        return;
      }
    }
  });

  // --- Local expiry safety net ---
  useEffect(() => {
    if (!incoming.length) return;
    const next = Math.min(...incoming.map((r) => r.receivedAt + LOCAL_RING_TTL_MS));
    const id = window.setTimeout(
      () => {
        const now = Date.now();
        setRingState((s) => ({ ...s, list: s.list.filter((r) => r.receivedAt + LOCAL_RING_TTL_MS > now) }));
      },
      Math.max(0, next - Date.now()) + 50,
    );
    return () => window.clearTimeout(id);
  }, [incoming]);

  // --- Actions ---
  const accept = useCallback(
    async (callId: string, withVideo: boolean) => {
      const entry = incoming.find((r) => r.call.id === callId);
      remove(callId);
      tones.stop("ring");
      const channelId = entry?.call.channel_id;
      if (channelId) router.push(`/w/${workspaceId}/c/${channelId}`);
      const joined = await acceptCall(callId, withVideo, channelId);
      // Backed out of the "Ready to join?" check: bring the ring back if it's still ringing.
      if (!joined) setReloadKey((k) => k + 1);
    },
    [incoming, remove, acceptCall, router, workspaceId],
  );

  const decline = useCallback(
    async (callId: string) => {
      remove(callId);
      tones.stop("ring");
      await api(`/calls/${callId}/decline`, { method: "POST" }).catch(() => {});
    },
    [remove],
  );

  const setSoundsMuted = useCallback((muted: boolean) => callSoundMute.set(muted), []);

  // --- Sounds ---
  useEffect(() => installUnlock(), []);
  useEffect(() => () => tones.stopAll(), []);
  // Tab closing / navigating away / going into the bfcache: never leave a tone looping.
  useEffect(() => {
    const stop = () => tones.stopAll();
    window.addEventListener("pagehide", stop);
    window.addEventListener("beforeunload", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("beforeunload", stop);
    };
  }, []);

  const ringing = incoming.length > 0;
  useEffect(() => {
    if (!ringing || soundsMuted) return;
    tones.start("ring");
    return () => tones.stop("ring");
  }, [ringing, soundsMuted]);

  const meId = me?.id;
  const ringingBackRaw =
    !!myCall &&
    myStatus !== "connecting" &&
    ringingInvites(myCall.invites, meId).length > 0 &&
    !myCall.joined_ids.some((id) => id !== meId) &&
    !myCall.participant_ids.some((id) => id !== meId);
  const ringKey = myCall ? `${myCall.id}:${ringingInvites(myCall.invites, meId).map((i) => i.user_id).join(",")}` : null;
  // Safety net: if the server's "no answer" never reaches us, stop the ring-back anyway.
  const ringbackTimedOut = useTimedOut(ringKey, ringingBackRaw);
  const ringingBack = ringingBackRaw && !ringbackTimedOut;
  useEffect(() => {
    if (!ringingBack || soundsMuted || ringing) return;
    tones.start("ringback");
    return () => tones.stop("ringback");
  }, [ringingBack, soundsMuted, ringing]);

  // --- Desktop notification + title flash for the call on top ---
  const top = incoming[0];
  const topId = top?.call.id;
  const callerName = top ? firstName(memberById[top.caller_id]?.full_name) : "";
  const topChannel = top ? channels.find((c) => c.id === top.call.channel_id) : undefined;
  const where = channelContext(topChannel);
  const topKind = top?.call.kind;

  useEffect(() => {
    if (!topId || typeof Notification === "undefined") return;
    let n: Notification | null = null;
    const show = () => {
      if (n || !isAway() || Notification.permission !== "granted") return;
      try {
        n = new Notification(`${callerName} is calling you`, {
          body: `${topKind === "video" ? "Video call" : "Audio call"}${where ? ` · ${where}` : ""}`,
          tag: `call-${topId}`,
          requireInteraction: true,
        });
        n.onclick = () => {
          bringToFront();
          n?.close();
        };
      } catch {
        // Android Chrome: needs a service worker for notifications.
      }
    };
    show();
    document.addEventListener("visibilitychange", show);
    window.addEventListener("blur", show);
    return () => {
      document.removeEventListener("visibilitychange", show);
      window.removeEventListener("blur", show);
      n?.close();
    };
  }, [topId, callerName, topKind, where]);

  useEffect(() => {
    if (!topId) return;
    const flash = `📞 ${callerName} is calling…`;
    let original = document.title;
    let on = false;
    const id = window.setInterval(() => {
      if (document.title !== flash) original = document.title;
      on = !on;
      document.title = on ? flash : original;
    }, 1000);
    return () => {
      window.clearInterval(id);
      if (document.title === flash) document.title = original;
    };
  }, [topId, callerName]);

  const value = useMemo<CallsCtx>(
    () => ({ incoming, accept, decline, soundsMuted, setSoundsMuted }),
    [incoming, accept, decline, soundsMuted, setSoundsMuted],
  );

  return (
    <Ctx.Provider value={value}>
      <CallStyles />
      {children}
      <OutgoingCall />
      <IncomingCall />
      <HuddleBanner soundsMuted={soundsMuted} />
      <MeetingStartingAlert soundsMuted={soundsMuted} />
    </Ctx.Provider>
  );
}
