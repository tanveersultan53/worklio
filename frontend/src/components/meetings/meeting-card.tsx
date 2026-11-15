"use client";

import { CalendarPlus, Check, Download, Headphones, MoreHorizontal, Pencil, Video, X } from "lucide-react";
import { useState } from "react";

import { CallAvatarStack } from "@/components/calls/avatar-stack";
import { useHuddles } from "@/components/huddle/huddle-provider";
import { useNow } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/provider";
import type { Message } from "@/lib/api";
import {
  downloadIcs,
  googleCalendarUrl,
  isLive,
  isOver,
  meetingsApi,
  meetingsChanged,
  myResponse,
  relativeStart,
  whenLabel,
  type Meeting,
  type RSVPResponse,
} from "@/lib/meetings";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { ScheduleMeetingDialog } from "./schedule-dialog";

/** The meeting card a scheduled meeting posts in its channel (system message, meta.type "meeting"). */
export function MeetingSystemMessage({ message }: { message: Message }) {
  const meeting = (message.meta as { meeting?: Meeting } | null)?.meeting;
  if (!meeting) return null;
  return <MeetingCard meeting={meeting} />;
}

const JOIN_EARLY_MS = 10 * 60_000;

export function MeetingCard({ meeting: m, compact = false }: { meeting: Meeting; compact?: boolean }) {
  const { me, memberById, workspaceId, isAdmin } = useWorkspace();
  const { join, activeChannelId } = useHuddles();
  const now = useNow();
  const [busy, setBusy] = useState<RSVPResponse | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const start = new Date(m.starts_at);
  const cancelled = m.status === "cancelled";
  const live = isLive(m, now);
  const over = isOver(m, now);
  const canJoin = !cancelled && !over && start.getTime() - now <= JOIN_EARLY_MS;
  const mine = myResponse(m, me?.id);
  const organizer = memberById[m.organizer_id]?.full_name ?? "Someone";
  const canManage = !cancelled && !over && (m.organizer_id === me?.id || isAdmin);
  const going = m.attendees.filter((a) => a.response === "accepted").map((a) => a.user_id);
  const maybe = m.attendees.filter((a) => a.response === "tentative").length;
  const declined = m.attendees.filter((a) => a.response === "declined").length;
  const waiting = m.attendees.filter((a) => a.response === "pending").length;
  const inThis = activeChannelId === m.channel_id;
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/w/${workspaceId}/c/${m.channel_id}`;

  async function answer(r: Exclude<RSVPResponse, "pending">) {
    setBusy(r);
    try {
      meetingsChanged(await meetingsApi.rsvp(m.id, r));
    } catch (err) {
      toast.error(errorMessage(err, "Could not save your answer"));
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    try {
      meetingsChanged(await meetingsApi.cancel(m.id));
      toast.success("Meeting cancelled");
    } catch (err) {
      toast.error(errorMessage(err, "Could not cancel the meeting"));
    }
  }

  // Only unusual states get a pill; an upcoming meeting just says when, in plain words.
  const status = cancelled ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Cancelled</span>
  ) : live ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
      <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      Happening now
    </span>
  ) : over ? (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Ended</span>
  ) : null;

  const counts = [
    { n: going.length, label: "going", cls: "text-emerald-700 dark:text-emerald-300" },
    { n: maybe, label: "maybe", cls: "text-amber-700 dark:text-amber-300" },
    { n: declined, label: "can't go", cls: "text-red-600 dark:text-red-400" },
    { n: waiting, label: "waiting", cls: "text-muted-foreground" },
  ].filter((c) => c.n > 0);
  const isOrganizer = m.organizer_id === me?.id;
  const accent = cancelled || over ? "before:bg-muted-foreground/30" : live ? "before:bg-emerald-500" : "before:bg-[#e5375f]";

  return (
    <article
      aria-label={`Meeting: ${m.title}`}
      className={cn(
        "relative mt-1 w-full max-w-lg overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs",
        // A thin colour bar on the left says upcoming / live / over at a glance.
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent,
        cancelled && "opacity-80",
      )}
    >
      <div className="flex items-start gap-3 py-3 pr-2 pl-4">
        <div
          aria-hidden
          className={cn(
            "flex h-[52px] w-12 shrink-0 flex-col items-center overflow-hidden rounded-lg border text-center",
            cancelled ? "bg-muted" : "bg-background",
          )}
        >
          <span className={cn("w-full py-0.5 text-[10px] leading-tight font-bold text-white uppercase", cancelled || over ? "bg-muted-foreground" : "bg-[#e5375f]")}>
            {start.toLocaleDateString(undefined, { month: "short" })}
          </span>
          <span className="flex flex-1 items-center text-lg leading-none font-black tabular-nums">{start.getDate()}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className={cn("min-w-0 flex-1 text-[15px] leading-snug font-bold [overflow-wrap:anywhere]", cancelled && "line-through")}>
              {m.title}
            </h3>
            {status && <span className="mt-0.5 shrink-0">{status}</span>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
            {m.kind === "video" ? <Video className="size-3.5 shrink-0" aria-hidden /> : <Headphones className="size-3.5 shrink-0" aria-hidden />}
            <span>{whenLabel(m)}</span>
            {!cancelled && !over && !live && <span className="text-foreground/70">· {relativeStart(m, now)}</span>}
          </p>

          {!compact && m.description && (
            <div className="mt-2 border-l-2 border-border pl-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground">Agenda</p>
              <p className="line-clamp-3 text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">{m.description}</p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {m.attendees.length > 0 && (
              <CallAvatarStack ids={[...going, ...m.attendees.filter((a) => a.response !== "accepted").map((a) => a.user_id)]} max={5} size="sm" ringClassName="ring-card" />
            )}
            <span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
              {counts.map((c, i) => (
                <span key={c.label} className={cn("font-semibold", c.cls)}>
                  {i > 0 && <span className="mr-1.5 font-normal text-muted-foreground">·</span>}
                  {c.n} {c.label}
                </span>
              ))}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isOrganizer ? "You're organizing" : `Organized by ${organizer}`}
          </p>
        </div>

        {(canManage || !cancelled) && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Meeting options" className="-mt-1 shrink-0" />}>
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {!cancelled && (
                <>
                  <DropdownMenuItem onClick={() => void downloadIcs(m).catch((err) => toast.error(errorMessage(err)))}>
                    <Download />
                    Download .ics
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open(googleCalendarUrl(m, link), "_blank", "noopener")}>
                    <CalendarPlus />
                    Add to Google Calendar
                  </DropdownMenuItem>
                </>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setEditOpen(true)}>
                    <Pencil />
                    Edit meeting
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => void cancel()}>
                    <X />
                    Cancel meeting
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!cancelled && !over && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 py-2 pr-3 pl-4">
          {canJoin && !inThis && (
            <Button
              size="sm"
              onClick={() => void join(m.channel_id, m.kind === "video" ? { video: true } : undefined)}
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
            >
              {m.kind === "video" ? <Video aria-hidden /> : <Headphones aria-hidden />}
              Join
            </Button>
          )}
          {inThis && <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">You’re in this huddle</span>}
          {!isOrganizer ? (
            <div role="group" aria-label="Are you going?" className="ml-auto flex items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">Going?</span>
              {(
                [
                  ["accepted", "Yes", Check],
                  ["tentative", "Maybe", null],
                  ["declined", "No", X],
                ] as const
              ).map(([r, label, Icon]) => (
                <Button
                  key={r}
                  size="xs"
                  variant={mine === r ? "default" : "outline"}
                  aria-pressed={mine === r}
                  disabled={busy !== null}
                  onClick={() => void answer(r)}
                  className="gap-1"
                >
                  {Icon && <Icon aria-hidden />}
                  {label}
                </Button>
              ))}
            </div>
          ) : (
            // The organizer's footer does something useful: put it in their own calendar.
            <div className="ml-auto flex items-center gap-1">
              <Button size="xs" variant="outline" className="gap-1" onClick={() => window.open(googleCalendarUrl(m, link), "_blank", "noopener")}>
                <CalendarPlus aria-hidden />
                Add to Google Calendar
              </Button>
              <Button size="xs" variant="ghost" className="gap-1" onClick={() => void downloadIcs(m).catch((err) => toast.error(errorMessage(err)))}>
                <Download aria-hidden />
                .ics
              </Button>
            </div>
          )}
        </div>
      )}

      {canManage && <ScheduleMeetingDialog open={editOpen} onOpenChange={setEditOpen} meeting={m} />}
    </article>
  );
}
