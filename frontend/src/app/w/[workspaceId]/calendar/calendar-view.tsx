"use client";

import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Headphones, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { MeetingCard } from "@/components/meetings/meeting-card";
import { ScheduleMeetingDialog } from "@/components/meetings/schedule-dialog";
import { useNow } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorBlock, LoadingList, ViewHeader, ViewPage, ViewTabs } from "@/components/views/view-shell";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import {
  addDays,
  dayLabel,
  isLive,
  MEETINGS_CHANGED,
  meetingsApi,
  myResponse,
  startOfWeek,
  timeLabel,
  type Meeting,
} from "@/lib/meetings";
import { errorMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Tab = "week" | "upcoming";
const TABS = [
  { key: "week" as const, label: "Week" },
  { key: "upcoming" as const, label: "Upcoming" },
];

const HOUR_PX = 48;
const UPCOMING_DAYS = 30;

/** Load meetings in [from, to), refetching on any meeting change. */
function useMeetings(workspaceId: string, from: Date, to: Date) {
  const [state, setState] = useState<{ key: string; items: Meeting[] | null; error: string }>({
    key: "",
    items: null,
    error: "",
  });
  const key = `${workspaceId}|${from.getTime()}|${to.getTime()}`;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    meetingsApi
      .range(workspaceId, from, to)
      .then((items) => !cancelled && setState({ key, items, error: "" }))
      .catch((err) => !cancelled && setState({ key, items: null, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
    // `from`/`to` are captured by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    const on = () => reload();
    window.addEventListener(MEETINGS_CHANGED, on);
    return () => window.removeEventListener(MEETINGS_CHANGED, on);
  }, [reload]);
  useWorkspaceEvents((e) => {
    if (e.type === "meeting.updated" || e.type === "resync") reload();
  });

  const fresh = state.key === key;
  return { items: fresh ? state.items : null, error: fresh ? state.error : "", reload };
}

export function CalendarView() {
  const { workspaceId } = useWorkspace();
  const [tab, setTab] = useState<Tab>("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [schedule, setSchedule] = useState<{ open: boolean; start?: Date }>({ open: false });
  const [opened, setOpened] = useState<Meeting | null>(null);

  const thisWeek = startOfWeek(new Date()).getTime() === weekStart.getTime();
  const weekEnd = addDays(weekStart, 7);
  const range = `${weekStart.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <ViewPage label="Calendar">
      <ViewHeader
        icon={CalendarDays}
        title="Calendar"
        subtitle="Huddles you're organizing or invited to"
        actions={
          <Button size="sm" onClick={() => setSchedule({ open: true })} className="gap-1.5">
            <CalendarPlus aria-hidden />
            <span className="hidden sm:inline">Schedule a huddle</span>
            <span className="sm:hidden">Schedule</span>
          </Button>
        }
      >
        <ViewTabs
          tabs={TABS}
          value={tab}
          onChange={setTab}
          label="Calendar views"
          trailing={
            tab === "week" && (
              <>
                <Button size="sm" variant="outline" disabled={thisWeek} onClick={() => setWeekStart(startOfWeek(new Date()))}>
                  Today
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}>
                  <ChevronLeft aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}>
                  <ChevronRight aria-hidden />
                </Button>
                <span className="hidden text-[13px] font-semibold whitespace-nowrap md:inline">{range}</span>
              </>
            )
          }
        />
      </ViewHeader>

      {tab === "week" ? (
        <WeekGrid
          workspaceId={workspaceId}
          weekStart={weekStart}
          weekEnd={weekEnd}
          onPickSlot={(start) => setSchedule({ open: true, start })}
          onOpen={setOpened}
        />
      ) : (
        <Upcoming workspaceId={workspaceId} onSchedule={() => setSchedule({ open: true })} />
      )}

      <ScheduleMeetingDialog
        open={schedule.open}
        start={schedule.start}
        onOpenChange={(open) => setSchedule((s) => ({ ...s, open }))}
      />
      <Dialog open={!!opened} onOpenChange={(o) => !o && setOpened(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="sr-only">{opened?.title ?? "Meeting"}</DialogTitle>
          {opened && <OpenedMeeting id={opened.id} fallback={opened} onClose={() => setOpened(null)} />}
        </DialogContent>
      </Dialog>
    </ViewPage>
  );
}

/** The meeting in a dialog, kept live (RSVPs, edits) while it's open. */
function OpenedMeeting({ id, fallback, onClose }: { id: string; fallback: Meeting; onClose: () => void }) {
  const { workspaceId, channels, channelLabel } = useWorkspace();
  const [m, setM] = useState(fallback);
  useWorkspaceEvents((e) => {
    if (e.type === "meeting.updated" && e.meeting.id === id) setM(e.meeting);
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Meeting | undefined>).detail;
      if (d?.id === id) setM(d);
    };
    window.addEventListener(MEETINGS_CHANGED, on);
    return () => window.removeEventListener(MEETINGS_CHANGED, on);
  }, [id]);
  const channel = channels.find((c) => c.id === m.channel_id);
  return (
    <div className="grid gap-3 pt-4">
      <MeetingCard meeting={m} />
      {channel && (
        <Link
          href={`/w/${workspaceId}/c/${m.channel_id}`}
          onClick={onClose}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Open {channel.kind === "dm" ? channelLabel(channel) : `#${channel.name}`}
        </Link>
      )}
    </div>
  );
}

// --- Week grid --------------------------------------------------------------------------------

type Placed = { m: Meeting; top: number; height: number; lane: number; lanes: number };

/** Lay out one day's meetings in side-by-side lanes where they overlap. */
function layoutDay(items: Meeting[], day: Date): Placed[] {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const spans = items
    .map((m) => {
      const s = Math.max(new Date(m.starts_at).getTime(), dayStart);
      const e = Math.min(new Date(m.ends_at).getTime(), dayEnd);
      return { m, s, e };
    })
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Placed[] = [];
  let group: { item: (typeof spans)[number]; lane: number }[] = [];
  let groupEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) {
      out.push({
        m: g.item.m,
        top: ((g.item.s - dayStart) / 3_600_000) * HOUR_PX,
        height: Math.max(((g.item.e - g.item.s) / 3_600_000) * HOUR_PX, 22),
        lane: g.lane,
        lanes,
      });
    }
    group = [];
  };
  for (const item of spans) {
    if (group.length && item.s >= groupEnd) flush();
    const laneEnds: number[] = [];
    for (const g of group) laneEnds[g.lane] = Math.max(laneEnds[g.lane] ?? 0, g.item.e);
    let lane = laneEnds.findIndex((end) => end <= item.s);
    if (lane === -1) lane = laneEnds.length;
    group.push({ item, lane });
    groupEnd = Math.max(groupEnd, item.e);
  }
  if (group.length) flush();
  return out;
}

function WeekGrid({
  workspaceId,
  weekStart,
  weekEnd,
  onPickSlot,
  onOpen,
}: {
  workspaceId: string;
  weekStart: Date;
  weekEnd: Date;
  onPickSlot: (start: Date) => void;
  onOpen: (m: Meeting) => void;
}) {
  const { me } = useWorkspace();
  const { items, error, reload } = useMeetings(workspaceId, weekStart, weekEnd);
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Open the grid at 8 AM, or with "now" a third of the way down if that's later.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const d = new Date();
    const nowPx = ((d.getHours() * 60 + d.getMinutes()) / 60) * HOUR_PX;
    el.scrollTop = Math.max(8 * HOUR_PX, nowPx - el.clientHeight / 3);
  }, [weekStart]);

  const byDay = useMemo(
    () =>
      days.map((d) =>
        layoutDay(
          (items ?? []).filter((m) => {
            const s = new Date(m.starts_at).getTime();
            const e = new Date(m.ends_at).getTime();
            return s < addDays(d, 1).getTime() && e > d.getTime();
          }),
          d,
        ),
      ),
    [items, days],
  );

  if (error) return <ErrorBlock message={error} onRetry={reload} />;

  const today = new Date(now);
  const isToday = (d: Date) => d.toDateString() === today.toDateString();
  const nowTop = ((today.getHours() * 60 + today.getMinutes()) / 60) * HOUR_PX;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day headers */}
      <div className="grid shrink-0 grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] border-b pr-[var(--sbw,0px)]">
        <span />
        {days.map((d) => (
          <div key={d.toISOString()} className="border-l px-1 py-1.5 text-center">
            <div className="text-[11px] font-semibold text-muted-foreground">
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div
              className={cn(
                "mx-auto mt-0.5 flex size-7 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                isToday(d) && "bg-[#e5375f] text-white",
              )}
            >
              {d.getDate()}
            </div>
          </div>
        ))}
      </div>

      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto" aria-busy={items === null}>
        <div className="mb-4 grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] border-b" style={{ height: 24 * HOUR_PX }}>
          {/* Hour labels */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10.5px] text-muted-foreground tabular-nums"
                style={{ top: h * HOUR_PX }}
              >
                {h === 0 ? "" : timeLabel(new Date(2000, 0, 1, h)).replace(":00", "")}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <div key={d.toISOString()} className="relative border-l">
              {/* Half-hour slots: click to schedule. */}
              {Array.from({ length: 48 }, (_, s) => {
                const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(s / 2), (s % 2) * 30);
                const past = start.getTime() < now - 5 * 60_000;
                return (
                  <button
                    key={s}
                    type="button"
                    tabIndex={-1}
                    disabled={past}
                    aria-label={`Schedule a huddle ${dayLabel(start)} at ${timeLabel(start)}`}
                    onClick={() => onPickSlot(start)}
                    className={cn(
                      "absolute inset-x-0 block outline-none",
                      s % 2 === 0 ? "border-t border-border/70" : "border-t border-dashed border-border/40",
                      past ? "cursor-default bg-muted/25" : "hover:bg-primary/5",
                    )}
                    style={{ top: (s * HOUR_PX) / 2, height: HOUR_PX / 2 }}
                  />
                );
              })}
              {isToday(d) && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20" style={{ top: nowTop }}>
                  <div className="relative h-0.5 bg-[#e5375f]">
                    <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-[#e5375f]" />
                  </div>
                </div>
              )}
              {byDay[i].map(({ m, top, height, lane, lanes }) => {
                const mine = myResponse(m, me?.id);
                const live = isLive(m, now);
                return (
                  <button
                    key={`${m.id}-${i}`}
                    type="button"
                    onClick={() => onOpen(m)}
                    aria-label={`${m.title}, ${timeLabel(new Date(m.starts_at))} to ${timeLabel(new Date(m.ends_at))}`}
                    className={cn(
                      "absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[11.5px] leading-tight shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      live
                        ? "border-emerald-600 bg-emerald-100 text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-50"
                        : mine === "declined"
                          ? "border-muted-foreground/50 bg-muted text-muted-foreground line-through"
                          : mine === "pending" || mine === "tentative"
                            ? "border-sky-500 bg-background text-foreground ring-1 ring-sky-500/40 ring-inset"
                            : "border-sky-600 bg-sky-100 text-sky-950 dark:bg-sky-900/60 dark:text-sky-50",
                    )}
                    style={{
                      top: top + 1,
                      height: height - 2,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      {m.kind === "video" ? (
                        <Video className="size-3 shrink-0" aria-hidden />
                      ) : (
                        <Headphones className="size-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">{m.title}</span>
                    </span>
                    {height >= 36 && (
                      <span className="block truncate opacity-80">
                        {timeLabel(new Date(m.starts_at))} – {timeLabel(new Date(m.ends_at))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Upcoming ---------------------------------------------------------------------------------

function Upcoming({ workspaceId, onSchedule }: { workspaceId: string; onSchedule: () => void }) {
  const [from] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const to = useMemo(() => addDays(from, UPCOMING_DAYS), [from]);
  const { items, error, reload } = useMeetings(workspaceId, from, to);
  const now = useNow();

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (items === null) return <LoadingList variant="card" rows={3} />;
  const upcoming = items.filter((m) => new Date(m.ends_at).getTime() > now);
  if (!upcoming.length) {
    return (
      <EmptyState icon={CalendarDays} title="Nothing scheduled">
        <p>Book a huddle for later and everyone you invite gets a reminder and a ring when it starts.</p>
        <Button size="sm" className="mt-3 gap-1.5" onClick={onSchedule}>
          <CalendarPlus aria-hidden />
          Schedule a huddle
        </Button>
      </EmptyState>
    );
  }
  const groups = new Map<string, Meeting[]>();
  for (const m of upcoming) {
    const k = new Date(m.starts_at).toDateString();
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      <div className="mx-auto grid max-w-2xl gap-6">
        {[...groups.entries()].map(([k, ms]) => (
          <section key={k} aria-label={dayLabel(new Date(k))}>
            <h2 className="mb-2 text-sm font-bold">{dayLabel(new Date(k))}</h2>
            <div className="grid gap-2">
              {ms.map((m) => (
                <MeetingCard key={m.id} meeting={m} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
