"use client";

import { CalendarClock, Headphones, Video, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CallAvatarStack } from "@/components/calls/avatar-stack";
import { playHuddleChime } from "@/components/calls/tones";
import { useHuddles } from "@/components/huddle/huddle-provider";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { timeLabel, type Meeting } from "@/lib/meetings";

/** How long the "starting now" card stays up if nobody acts on it. */
const TTL_MS = 5 * 60_000;
const MAX = 3;

/**
 * "📅 Weekly sync is starting" — the ring for a scheduled meeting, driven by the per-user
 * `meeting.starting` event. Join opens the channel's huddle; it hides itself when I join,
 * dismiss it, or after five minutes. Chimes and raises a desktop notification (background
 * tab) only when the server says my notification prefs allow it. Mount once inside
 * <CallProvider> (next to the huddle banner).
 */
export function MeetingStartingAlert({ soundsMuted }: { soundsMuted: boolean }) {
  const { workspaceId, channels, channelLabel, memberById } = useWorkspace();
  const { join, activeChannelId } = useHuddles();
  const router = useRouter();
  const [list, setList] = useState<{ meeting: Meeting; until: number }[]>([]);

  useWorkspaceEvents((e) => {
    if (e.type === "meeting.starting") {
      const m = e.meeting;
      if (m.workspace_id !== workspaceId || activeChannelId === m.channel_id) return;
      setList((l) => [...l.filter((x) => x.meeting.id !== m.id), { meeting: m, until: Date.now() + TTL_MS }].slice(-MAX));
      if (e.notify) {
        if (!soundsMuted) playHuddleChime();
        if (typeof Notification !== "undefined" && document.hidden && Notification.permission === "granted") {
          try {
            const n = new Notification(`📅 ${m.title} is starting`, {
              body: "Click to open Worklio and join the huddle.",
              tag: `meeting-${m.id}`,
            });
            n.onclick = () => {
              window.focus();
              router.push(`/w/${workspaceId}/c/${m.channel_id}`);
              n.close();
            };
          } catch {
            // Android Chrome needs a service worker for notifications.
          }
        }
      }
    } else if (e.type === "meeting.updated" && e.meeting.status === "cancelled") {
      setList((l) => l.filter((x) => x.meeting.id !== e.meeting.id));
    }
  });

  // Drop cards for the huddle I'm now in, and expired ones.
  const visible = list.filter((x) => x.meeting.channel_id !== activeChannelId);
  useEffect(() => {
    if (!list.length) return;
    const next = Math.min(...list.map((x) => x.until));
    const id = window.setTimeout(() => setList((l) => l.filter((x) => x.until > Date.now())), Math.max(0, next - Date.now()) + 50);
    return () => window.clearTimeout(id);
  }, [list]);

  if (!visible.length) return null;
  return (
    <div
      role="region"
      aria-label="Meetings starting"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-0 z-[151] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      {visible.map(({ meeting: m }) => {
        const ch = channels.find((c) => c.id === m.channel_id);
        const where = ch ? (ch.kind === "dm" ? channelLabel(ch) : `#${ch.name}`) : "a channel";
        const going = m.attendees.filter((a) => a.response !== "declined").map((a) => a.user_id);
        const dismiss = () => setList((l) => l.filter((x) => x.meeting.id !== m.id));
        return (
          <article
            key={m.id}
            aria-label={`${m.title} is starting`}
            onKeyDown={(e) => e.key === "Escape" && dismiss()}
            className="pointer-events-auto relative w-full max-w-[27rem] overflow-hidden rounded-2xl bg-popover/95 text-popover-foreground shadow-[0_18px_48px_-14px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-2 dark:bg-zinc-900/95 dark:ring-white/10"
          >
            <div className="flex items-start gap-3 p-3 pr-2">
              <span
                aria-hidden
                className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-pink-500/12 text-pink-700 ring-1 ring-pink-600/15 dark:text-pink-300"
              >
                <CalendarClock className="size-[18px]" />
                <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-pink-500 opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-pink-500 ring-2 ring-popover dark:ring-zinc-900" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-snug">
                  <span className="font-semibold">{m.title}</span> is starting in{" "}
                  <span className="font-semibold break-all">{where}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {timeLabel(new Date(m.starts_at))} – {timeLabel(new Date(m.ends_at))} · organized by{" "}
                  {memberById[m.organizer_id]?.full_name ?? "someone"}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <CallAvatarStack ids={going} max={4} size="sm" ringClassName="ring-popover dark:ring-zinc-900" />
                  <button
                    type="button"
                    onClick={() => {
                      dismiss();
                      void join(m.channel_id, m.kind === "video" ? { video: true } : undefined);
                    }}
                    className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-[13px] font-semibold text-white shadow-sm outline-none transition hover:bg-emerald-700 focus-visible:ring-3 focus-visible:ring-emerald-500/40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
                  >
                    {m.kind === "video" ? <Video className="size-3.5" aria-hidden /> : <Headphones className="size-3.5" aria-hidden />}
                    Join
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Dismiss"
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
