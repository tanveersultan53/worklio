"use client";

import { Headphones, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useHuddles } from "@/components/huddle/huddle-provider";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { bringToFront, isAway } from "@/lib/desktop";

import { CallAvatarStack } from "./avatar-stack";
import { playHuddleChime } from "./tones";
import { isCallLive } from "./types";

/**
 * "🎧 Alice started a huddle in #general" — a soft, top-centre banner (up to 3 stacked) driven by
 * the per-user `huddle.started` / `huddle.ended` events. Live avatars + count, Join / Join with
 * video / Dismiss. Hides itself after 30 s (paused while hovered or focused), when the huddle
 * ends, or when I'm in it. Never shown to the starter or when I'm being rung (the incoming-call
 * UI owns that). Plays a chime and, in a background tab, raises a desktop notification only when
 * the server says my notification prefs allow it (`notify`). Mount once, inside <CallProvider>.
 */

const TTL_MS = 30_000;
const MAX_BANNERS = 3;

type Banner = {
  callId: string;
  channelId: string;
  starterId: string;
  participantIds: string[];
  expiresAt: number;
};

type BannerState = { workspaceId: string; list: Banner[]; pausedAt: number | null };

const EMPTY: Banner[] = [];

const BANNER_CSS = `
@keyframes wk-huddle-banner-in { from { opacity: 0; transform: translateY(-10px) scale(.98) } to { opacity: 1; transform: none } }
@keyframes wk-huddle-banner-time { from { transform: scaleX(1) } to { transform: scaleX(0) } }
.wk-huddle-banner { animation: wk-huddle-banner-in .32s cubic-bezier(.2,.9,.3,1.2) both }
.wk-huddle-banner-time { animation-name: wk-huddle-banner-time; animation-timing-function: linear; animation-fill-mode: both }
@media (prefers-reduced-motion: reduce) {
  .wk-huddle-banner { animation: none }
  .wk-huddle-banner-time { display: none }
  .wk-huddle-banner-ping { animation: none !important; opacity: 0 }
}
`;

export function HuddleBanner({ soundsMuted }: { soundsMuted: boolean }) {
  const { workspaceId, me, memberById, channels } = useWorkspace();
  const { join, activeChannelId, huddles } = useHuddles();
  const router = useRouter();
  const [state, setState] = useState<BannerState>({ workspaceId: "", list: [], pausedAt: null });
  const notesRef = useRef(new Map<string, Notification>());

  const list = state.workspaceId === workspaceId ? state.list : EMPTY;
  const paused = state.workspaceId === workspaceId && state.pausedAt !== null;

  const remove = useCallback((pred: (b: Banner) => boolean) => {
    setState((s) => {
      const next = s.list.filter((b) => !pred(b));
      return next.length === s.list.length ? s : { ...s, list: next, pausedAt: next.length ? s.pausedAt : null };
    });
  }, []);

  const closeNote = (callId: string) => {
    const n = notesRef.current.get(callId);
    if (!n) return;
    notesRef.current.delete(callId);
    n.close();
  };

  const channelName = (channelId: string) => {
    const c = channels.find((x) => x.id === channelId);
    return c ? `#${c.name}` : "a channel";
  };
  const personName = (id: string) => memberById[id]?.full_name ?? "Someone";

  const notifyDesktop = (callId: string, channelId: string, starterId: string) => {
    if (typeof Notification === "undefined" || typeof document === "undefined") return;
    if (!isAway() || Notification.permission !== "granted") return;
    try {
      const n = new Notification(`🎧 ${personName(starterId)} started a huddle in ${channelName(channelId)}`, {
        body: "Click to open the channel and join.",
        tag: `huddle-${callId}`,
      });
      n.onclick = () => {
        bringToFront();
        router.push(`/w/${workspaceId}/c/${channelId}`);
        n.close();
      };
      notesRef.current.set(callId, n);
    } catch {
      // Android Chrome needs a service worker for notifications.
    }
  };

  useWorkspaceEvents((e) => {
    const meId = me?.id;
    switch (e.type) {
      case "huddle.started": {
        const { call, channel_id, starter_id, invited, notify } = e;
        if (invited || !meId || starter_id === meId) return;
        if (call.workspace_id && call.workspace_id !== workspaceId) return;
        if (activeChannelId === channel_id || call.participant_ids.includes(meId)) return;
        const banner: Banner = {
          callId: call.id,
          channelId: channel_id,
          starterId: starter_id,
          participantIds: call.participant_ids.length ? call.participant_ids : [starter_id],
          expiresAt: Date.now() + TTL_MS,
        };
        setState((s) => {
          const base = s.workspaceId === workspaceId ? s.list.filter((b) => b.channelId !== channel_id) : [];
          return {
            workspaceId,
            list: [...base, banner].slice(-MAX_BANNERS),
            pausedAt: s.workspaceId === workspaceId ? s.pausedAt : null,
          };
        });
        if (notify) {
          if (!soundsMuted) playHuddleChime();
          notifyDesktop(call.id, channel_id, starter_id);
        }
        return;
      }
      case "huddle.ended":
        remove((b) => b.callId === e.call_id || b.channelId === e.channel_id);
        closeNote(e.call_id);
        return;
      case "call.updated": {
        const { call } = e;
        if (!isCallLive(call) || (meId && call.participant_ids.includes(meId))) {
          remove((b) => b.callId === call.id);
          closeNote(call.id);
          return;
        }
        if (!call.participant_ids.length) return;
        setState((s) =>
          s.list.some((b) => b.callId === call.id)
            ? { ...s, list: s.list.map((b) => (b.callId === call.id ? { ...b, participantIds: call.participant_ids } : b)) }
            : s,
        );
        return;
      }
      case "huddle.updated": {
        const { channel_id, participant_ids } = e;
        if (!participant_ids.length || (meId && participant_ids.includes(meId))) {
          remove((b) => b.channelId === channel_id);
          return;
        }
        setState((s) =>
          s.list.some((b) => b.channelId === channel_id)
            ? { ...s, list: s.list.map((b) => (b.channelId === channel_id ? { ...b, participantIds: participant_ids } : b)) }
            : s,
        );
        return;
      }
    }
  });

  // --- Auto-hide (paused while the stack is hovered / focused) ---
  useEffect(() => {
    if (!list.length || paused) return;
    const next = Math.min(...list.map((b) => b.expiresAt));
    const id = window.setTimeout(
      () => {
        const now = Date.now();
        setState((s) => ({ ...s, list: s.list.filter((b) => b.expiresAt > now) }));
      },
      Math.max(0, next - Date.now()) + 50,
    );
    return () => window.clearTimeout(id);
  }, [list, paused]);

  const pause = () => setState((s) => (s.pausedAt !== null || !s.list.length ? s : { ...s, pausedAt: Date.now() }));
  const resume = () =>
    setState((s) => {
      if (s.pausedAt === null) return s;
      const shift = Date.now() - s.pausedAt;
      return { ...s, pausedAt: null, list: s.list.map((b) => ({ ...b, expiresAt: b.expiresAt + shift })) };
    });

  // Close any desktop notifications we raised when the shell goes away.
  useEffect(() => {
    const notes = notesRef.current;
    return () => {
      notes.forEach((n) => n.close());
      notes.clear();
    };
  }, []);

  const visible = list.filter((b) => b.channelId !== activeChannelId);

  return (
    <div
      role="region"
      aria-label="Huddle alerts"
      aria-live="polite"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume();
      }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[150] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <style href="wk-huddle-banner" precedence="default">
        {BANNER_CSS}
      </style>
      {visible.map((b) => {
        const people = huddles[b.channelId]?.participant_ids?.length ? huddles[b.channelId].participant_ids : b.participantIds;
        return (
          <BannerCard
            key={b.callId}
            banner={b}
            people={people}
            starter={personName(b.starterId)}
            channel={channelName(b.channelId)}
            paused={paused}
            onJoin={(video) => {
              remove((x) => x.channelId === b.channelId);
              closeNote(b.callId);
              void join(b.channelId, video ? { video: true } : undefined);
            }}
            onDismiss={() => remove((x) => x.callId === b.callId)}
          />
        );
      })}
    </div>
  );
}

function BannerCard({
  banner,
  people,
  starter,
  channel,
  paused,
  onJoin,
  onDismiss,
}: {
  banner: Banner;
  people: string[];
  starter: string;
  channel: string;
  paused: boolean;
  onJoin: (video: boolean) => void;
  onDismiss: () => void;
}) {
  const count = people.length;
  const titleId = `huddle-banner-${banner.callId}`;
  return (
    <article
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
      className="wk-huddle-banner pointer-events-auto relative w-full max-w-[27rem] overflow-hidden rounded-2xl bg-popover/95 text-popover-foreground shadow-[0_18px_48px_-14px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10 backdrop-blur-xl dark:bg-zinc-900/95 dark:shadow-[0_22px_60px_-16px_rgb(0_0_0/0.8)] dark:ring-white/10"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(240px_110px_at_0%_0%,rgb(16_185_129/0.14),transparent_70%)] dark:bg-[radial-gradient(240px_110px_at_0%_0%,rgb(16_185_129/0.2),transparent_70%)]"
      />
      <div className="relative flex items-start gap-3 p-3 pr-2">
        <span
          aria-hidden
          className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-600/15 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-300/20"
        >
          <Headphones className="size-[18px]" />
          <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
            <span className="wk-huddle-banner-ping absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500 ring-2 ring-popover dark:ring-zinc-900" />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <p id={titleId} className="pr-1 text-[13.5px] leading-snug">
            <span aria-hidden>🎧 </span>
            <span className="font-semibold">{starter}</span> started a huddle in{" "}
            <span className="font-semibold break-all">{channel}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <CallAvatarStack ids={people} max={4} size="sm" ringClassName="ring-popover dark:ring-zinc-900" />
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {count} {count === 1 ? "person" : "people"} here
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onJoin(true)}
                aria-label={`Join the huddle in ${channel} with video`}
                title="Join with video"
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground ring-1 ring-foreground/10 outline-none transition hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:ring-white/10 dark:hover:bg-white/10"
              >
                <Video className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => onJoin(false)}
                aria-label={`Join the huddle in ${channel}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-[13px] font-semibold text-white shadow-sm outline-none transition hover:bg-emerald-700 focus-visible:ring-3 focus-visible:ring-emerald-500/40 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
              >
                <Headphones className="size-3.5" aria-hidden />
                Join
              </button>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="-mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/10"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* Time left before it tucks itself away. Pauses with the stack. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/[0.04]">
        <span
          className="wk-huddle-banner-time block h-full origin-left bg-emerald-500/60"
          style={{ animationDuration: `${TTL_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      </span>
    </article>
  );
}
