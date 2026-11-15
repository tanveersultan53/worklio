"use client";

import {
  CheckSquare,
  Headphones,
  LoaderCircle,
  NotebookPen,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  Square,
  Video,
} from "lucide-react";
import { useState } from "react";

import { formatElapsed, useNow } from "@/components/huddle/hooks";
import { useHuddles } from "@/components/huddle/huddle-provider";
import { useWorkspace } from "@/components/workspace/provider";
import type { Message } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CallAvatarStack } from "./avatar-stack";
import { useCalls } from "./call-provider";
import { CallStyles, firstName, formatDuration, isSelfDM, timeOfDay } from "./call-styles";
import type { CallMessageMeta, CallStatus, MessageWithMeta } from "./types";
import { isCallMessageMeta, isCallNotesMeta } from "./types";

type AnyMessage = Message | MessageWithMeta;

const metaOf = (m: AnyMessage) => (m as MessageWithMeta).meta;

/** True for system messages this module renders (call cards and call notes). */
export function isCallSystemMessage(m: AnyMessage): boolean {
  const meta = metaOf(m);
  return isCallMessageMeta(meta) || isCallNotesMeta(meta);
}

/**
 * A call that's over (ended, missed, declined, cancelled). These render as one quiet line with no
 * name/avatar header, so a DM with a few calls doesn't turn into a wall of cards.
 */
export function isFinishedCallMessage(m: AnyMessage): boolean {
  const meta = metaOf(m);
  return isCallMessageMeta(meta) && meta.status !== "ringing" && meta.status !== "active";
}

/** Renders the right card for a call system message, or null for anything else. */
export function CallSystemMessage({ message, className }: { message: AnyMessage; className?: string }) {
  const meta = metaOf(message);
  if (isCallMessageMeta(meta)) return <CallMessageCard message={message} className={className} />;
  if (isCallNotesMeta(meta)) return <CallNotesCard message={message} className={className} />;
  return null;
}

/** Timeline card for a call (kind "system", meta.type "call"). Live while the call runs. */
export function CallMessageCard({ message, className }: { message: AnyMessage; className?: string }) {
  const raw = metaOf(message);
  if (!isCallMessageMeta(raw)) return null;
  return <CallCard meta={raw} channelId={message.channel_id} className={className} />;
}

function CallCard({ meta, channelId, className }: { meta: CallMessageMeta; channelId: string; className?: string }) {
  const { calls, call: myCall, activeChannelId, status: myStatus, startCall, leave } = useHuddles();
  const { incoming, accept } = useCalls();
  const { me, memberById, channels } = useWorkspace();
  const [busy, setBusy] = useState(false);

  // Prefer the live call (realtime) over the message snapshot when they're the same call.
  const live = calls[channelId]?.id === meta.call_id ? calls[channelId] : null;
  const mine = myCall?.id === meta.call_id ? myCall : null;
  const current = mine ?? live;
  const status: CallStatus = current?.status ?? meta.status;
  const kind = current?.kind ?? meta.kind;
  const joined = current?.joined_ids ?? meta.joined_ids ?? [];
  const inCallNow = current?.participant_ids ?? [];
  const isLive = status === "ringing" || status === "active";
  const isVideo = kind === "video";

  const channel = channels.find((c) => c.id === channelId);
  const isDM = channel?.kind === "dm";
  const selfDM = isSelfDM(channel, me?.id);
  const callerIsMe = meta.started_by === me?.id;
  const starter = callerIsMe ? "You" : firstName(memberById[meta.started_by]?.full_name);
  const imIn = !!mine || (isLive && activeChannelId === channelId);
  const ringingForMe = incoming.find((r) => r.call.id === meta.call_id);
  const otherId = isDM ? channel?.member_ids.find((id) => id !== me?.id) : undefined;
  const otherName = otherId ? firstName(memberById[otherId]?.full_name) : "them";
  const canCall = isDM && !!channel && !channel.is_archived && !selfDM;

  const endedAt = current?.ended_at ?? meta.ended_at;
  const durationS =
    meta.duration_s ??
    (endedAt ? Math.max(0, (new Date(endedAt).getTime() - new Date(meta.started_at).getTime()) / 1000) : null);

  const noun = isDM ? (isVideo ? "video call" : "call") : isVideo ? "video huddle" : "huddle";
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const callNoun = isVideo ? "video call" : "call";

  // A ring the caller withdrew is a missed call from the callee's side (like phones do).
  const missedForMe = !callerIsMe && (status === "missed" || status === "cancelled");

  let title: string;
  let tone: "live" | "missed" | "muted" = "muted";
  let Icon = isVideo ? Video : isDM ? Phone : Headphones;
  const details: string[] = [];
  switch (status) {
    case "ringing":
    case "active":
      tone = "live";
      Icon = isVideo ? Video : PhoneCall;
      title =
        isDM && status === "ringing"
          ? callerIsMe
            ? `Calling ${otherName}…`
            : `${starter} is calling…`
          : `${starter} started a ${noun}`;
      break;
    case "missed":
      tone = "missed";
      Icon = PhoneMissed;
      title = callerIsMe ? "No answer" : `Missed ${callNoun}`;
      details.push(timeOfDay(meta.started_at));
      break;
    case "declined":
      tone = "missed";
      Icon = PhoneOff;
      title = callerIsMe ? "Call declined" : `You declined a ${callNoun}`;
      details.push(timeOfDay(meta.started_at));
      break;
    case "cancelled":
      tone = missedForMe ? "missed" : "muted";
      Icon = missedForMe ? PhoneMissed : PhoneOff;
      title = missedForMe ? `Missed ${callNoun}` : "Call cancelled";
      details.push(timeOfDay(meta.started_at));
      break;
    default: {
      title = `${Noun} ended`;
      if (durationS !== null && durationS >= 1) details.push(formatDuration(durationS));
      details.push(timeOfDay(meta.started_at));
    }
  }

  const people = isLive && inCallNow.length ? inCallNow : joined;
  // On ended calls one face (just the starter) says nothing; show the stack once 2+ took part.
  const showStack = isLive ? people.length > 0 : status === "ended" && people.length > 1;

  const run = (fn: () => Promise<unknown> | void) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  let action: React.ReactNode = null;
  if (isLive) {
    action = imIn ? (
      <button
        type="button"
        onClick={leave}
        disabled={myStatus === "connecting"}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-red-500/40 px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/10 focus-visible:ring-3 focus-visible:ring-red-500/30 focus-visible:outline-none disabled:opacity-60 dark:text-red-400"
      >
        <PhoneOff className="size-3.5" aria-hidden />
        Leave
      </button>
    ) : selfDM ? null : (
      <button
        type="button"
        disabled={busy || !!channel?.is_archived}
        onClick={run(() => (ringingForMe ? accept(meta.call_id, isVideo) : startCall(channelId, kind)))}
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm shadow-emerald-600/25 transition-[background-color,transform] hover:bg-emerald-700 focus-visible:ring-3 focus-visible:ring-emerald-500/40 focus-visible:outline-none active:scale-95 disabled:opacity-60"
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        ) : isVideo ? (
          <Video className="size-3.5" aria-hidden />
        ) : (
          <Headphones className="size-3.5" aria-hidden />
        )}
        {ringingForMe ? "Answer" : "Join"}
      </button>
    );
  } else if (canCall) {
    const callBack = missedForMe || (status === "declined" && callerIsMe) || (status === "missed" && callerIsMe);
    const label = missedForMe ? "Call back" : "Call again";
    action = (
      <button
        type="button"
        disabled={busy || !!activeChannelId}
        onClick={run(() => startCall(channelId, kind))}
        aria-label={`${label}${isVideo ? " with video" : ""}`}
        title={activeChannelId ? "Leave your current call first" : undefined}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50",
          callBack
            ? "bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 focus-visible:ring-emerald-500/30 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/15"
            : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/50",
        )}
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        ) : isVideo ? (
          <Video className="size-3.5" aria-hidden />
        ) : (
          <Phone className="size-3.5" aria-hidden />
        )}
        <span>{label}</span>
      </button>
    );
  }

  if (!isLive) {
    // Finished: one line. "Call back" stays visible for a call I missed; "Call again" on hover.
    const callBackVisible = missedForMe;
    return (
      <div className={cn("group/call flex min-h-7 max-w-full items-center gap-2 text-[13px] text-muted-foreground", className)}>
        <Icon
          aria-hidden
          className={cn("size-4 shrink-0", tone === "missed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground/80")}
        />
        <span className={cn("min-w-0 truncate", tone === "missed" ? "font-medium text-red-600 dark:text-red-400" : "text-foreground/80")}>
          {title}
        </span>
        {details.length > 0 && <span className="shrink-0 tabular-nums">· {details.filter(Boolean).join(" · ")}</span>}
        {showStack && <CallAvatarStack ids={people} size="sm" max={4} ringClassName="ring-background" />}
        {action && (
          <div
            className={cn(
              "shrink-0 transition-opacity",
              !callBackVisible && "opacity-0 group-hover/call:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            {action}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative mt-1 flex w-full max-w-[460px] items-center gap-3 overflow-hidden rounded-xl border bg-card p-2.5 pr-3 text-card-foreground shadow-xs",
        tone === "live" && "border-emerald-500/40 dark:border-emerald-400/30",
        tone === "missed" && "border-red-500/25 dark:border-red-400/20",
        className,
      )}
    >
      <CallStyles />
      {tone === "live" && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,rgb(16_185_129/0.10),transparent_55%)]"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "relative grid size-10 shrink-0 place-items-center rounded-xl",
          tone === "live" && "wk-call-live bg-emerald-500 text-white",
          tone === "missed" && "bg-red-500/12 text-red-600 dark:bg-red-400/12 dark:text-red-400",
          tone === "muted" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-[18px]" />
      </span>

      <div className="relative min-w-0 flex-1">
        <p className={cn("truncate text-sm font-semibold", tone === "missed" && "text-red-600 dark:text-red-400")}>
          {title}
        </p>
        <div className="mt-0.5 flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {showStack && <CallAvatarStack ids={people} size="sm" max={4} ringClassName="ring-card" />}
          {isLive ? (
            <LiveMeta
              startedAt={meta.started_at}
              ringing={status === "ringing" && joined.length <= 1}
              count={inCallNow.length}
            />
          ) : (
            <span className="truncate tabular-nums">{details.filter(Boolean).join(" · ")}</span>
          )}
        </div>
      </div>

      {action && <div className="relative shrink-0">{action}</div>}
    </div>
  );
}

function LiveMeta({ startedAt, ringing, count }: { startedAt: string; ringing: boolean; count: number }) {
  const now = useNow();
  const started = new Date(startedAt).getTime();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="wk-call-blink size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="truncate">
        <span className="font-medium text-emerald-700 dark:text-emerald-400">{ringing ? "Ringing" : "Live"}</span>
        {now && !Number.isNaN(started) ? (
          <>
            {" · "}
            <span className="tabular-nums">{formatElapsed(now - started)}</span>
          </>
        ) : null}
        {!ringing && count > 1 ? ` · ${count} in call` : ""}
      </span>
    </span>
  );
}

// --- Call notes (thread reply posted when a call with notes ends) ---

type NoteLine =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "li"; text: string; depth: number }
  | { t: "task"; text: string; done: boolean; depth: number }
  | { t: "p"; text: string }
  | { t: "gap" };

function parseNotes(body: string): NoteLine[] {
  const out: NoteLine[] = [];
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;
    const depth = Math.min(3, Math.floor(indent / 2));
    const line = raw.trim();
    if (!line) {
      if (out.length && out[out.length - 1].t !== "gap") out.push({ t: "gap" });
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) out.push({ t: "h", level: m[1].length as 1 | 2 | 3, text: m[2] });
    else if ((m = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/)))
      out.push({ t: "task", done: m[1].toLowerCase() === "x", text: m[2], depth });
    else if ((m = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/))) out.push({ t: "li", text: m[1], depth });
    else out.push({ t: "p", text: line });
  }
  while (out.length && out[out.length - 1].t === "gap") out.pop();
  return out;
}

/** Minimal inline formatting: **bold**, *italic*, `code`. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") && p.length > 4 ? (
          <strong key={i} className="font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 py-px font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith("*") && p.endsWith("*") && p.length > 2 ? (
          <em key={i}>{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const COLLAPSED_LINES = 14;

/** Thread reply with the notes taken during a call (meta.type "call_notes"). */
export function CallNotesCard({ message, className }: { message: AnyMessage; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = parseNotes(message.body ?? "");
  const long = lines.length > COLLAPSED_LINES;
  const visible = long && !expanded ? lines.slice(0, COLLAPSED_LINES) : lines;
  const tasks = lines.filter((l) => l.t === "task");
  const done = tasks.filter((l) => l.t === "task" && l.done).length;

  return (
    <div
      className={cn(
        "mt-1 w-full max-w-[560px] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="grid size-6 place-items-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300" aria-hidden>
          <NotebookPen className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">Call notes</span>
        {tasks.length > 0 && (
          <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums ring-1 ring-border">
            {done}/{tasks.length} done
          </span>
        )}
      </div>

      <div className="relative space-y-1 px-3.5 py-3 text-sm leading-relaxed">
        {visible.length === 0 && <p className="text-muted-foreground">No notes were taken.</p>}
        {visible.map((l, i) => {
          switch (l.t) {
            case "h":
              return (
                <p
                  key={i}
                  className={cn(
                    "font-semibold tracking-tight",
                    l.level === 1 ? "pt-1 text-base" : "pt-0.5 text-[14px]",
                    i === 0 && "pt-0",
                  )}
                >
                  <Inline text={l.text} />
                </p>
              );
            case "task":
              return (
                <p key={i} className="flex items-start gap-2" style={{ paddingLeft: l.depth * 16 }}>
                  {l.done ? (
                    <CheckSquare className="mt-[3px] size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
                  ) : (
                    <Square className="mt-[3px] size-4 shrink-0 text-muted-foreground" aria-label="To do" />
                  )}
                  <span className={cn(l.done && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                    <Inline text={l.text} />
                  </span>
                </p>
              );
            case "li":
              return (
                <p key={i} className="flex items-start gap-2" style={{ paddingLeft: l.depth * 16 }}>
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-foreground/50" aria-hidden />
                  <span>
                    <Inline text={l.text} />
                  </span>
                </p>
              );
            case "gap":
              return <div key={i} className="h-1.5" aria-hidden />;
            default:
              return (
                <p key={i}>
                  <Inline text={l.text} />
                </p>
              );
          }
        })}
        {long && !expanded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
          />
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full border-t px-3 py-2 text-left text-xs font-medium text-link hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
        >
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
