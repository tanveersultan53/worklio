"use client";

import { Bell, BellOff, BellRing, CalendarClock, Clock, MoonStar, Play, Send, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { useAppearance } from "@/components/appearance-provider";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@/lib/api";
import type { NotifyLevel, NotifySchedule } from "@/lib/appearance";
import {
  dndPresetUntil,
  formatUntil,
  playNotificationSound,
  putDnd,
  quietState,
  requestNotificationPermission,
  setDndUntilLocal,
  showDesktopNotification,
  useMinuteClock,
  useNotificationPermission,
  type WithDnd,
} from "@/lib/sidebar";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useOptionalWorkspace } from "./provider";

/* ------------------------------------------------------------ DND state */

/** The signed-in user's DND end + a `pause(until | null)` action with optimistic update and rollback. */
export function useDnd() {
  const ws = useOptionalWorkspace();
  const me = ws?.me as (User & WithDnd) | null | undefined;
  const dndUntil = me?.dnd_until ?? null;

  const pause = async (until: Date | null) => {
    if (!ws?.me) return;
    const current = ws.me as User & WithDnd;
    const previous = current.dnd_until ?? null;
    const iso = until ? until.toISOString() : null;
    ws.setMe({ ...current, dnd_until: iso } as User);
    setDndUntilLocal(iso);
    try {
      const saved = await putDnd(iso);
      ws.setMe({ ...current, ...saved });
      toast.success(iso ? `Notifications paused until ${formatUntil(iso)}` : "Notifications resumed");
    } catch (e) {
      ws.setMe({ ...current, dnd_until: previous } as User);
      setDndUntilLocal(previous);
      toast.error(errorMessage(e, "Couldn't change Do Not Disturb"));
    }
  };

  return { dndUntil, pause };
}

/** Live "are notifications quiet right now?" (re-evaluated every ~15 s so pauses end on time). */
export function useQuietState() {
  const { prefs } = useAppearance();
  const { dndUntil } = useDnd();
  const minute = useMinuteClock();
  // `minute` only drives re-evaluation; the server snapshot (0) means "not yet hydrated".
  return minute ? quietState(prefs, dndUntil, new Date(minute * 60_000 + 30_000)) : ({ quiet: false } as const);
}

/* ---------------------------------------------------------- DND button */

/** Bell in the sidebar header: pause / resume notifications. */
export function DndButton({ onOpenSchedule, className }: { onOpenSchedule: () => void; className?: string }) {
  const { dndUntil, pause } = useDnd();
  const quiet = useQuietState();
  const [custom, setCustom] = useState(false);
  const paused = quiet.quiet && quiet.reason === "dnd";
  const label = quiet.quiet
    ? quiet.reason === "dnd"
      ? `Notifications paused until ${formatUntil(quiet.until)}`
      : "Outside your notification schedule"
    : "Pause notifications";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={label}
          title={label}
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center rounded-md text-side-foreground hover:bg-side-hover hover:text-side-strong md:size-8",
            quiet.quiet && "text-side-strong",
            className,
          )}
        >
          {quiet.quiet ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          {quiet.quiet && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-badge" aria-hidden />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {quiet.quiet && (
            <>
              <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                <MoonStar className="mt-0.5 size-3.5 shrink-0" />
                <span>{label}</span>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{paused ? "Change pause" : "Pause notifications"}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => pause(dndPresetUntil("30m"))}>
              <Clock className="size-4" /> For 30 minutes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pause(dndPresetUntil("1h"))}>
              <Clock className="size-4" /> For 1 hour
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pause(dndPresetUntil("2h"))}>
              <Clock className="size-4" /> For 2 hours
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pause(dndPresetUntil("tomorrow"))}>
              <MoonStar className="size-4" /> Until tomorrow
              <span className="ml-auto text-xs text-muted-foreground">9:00 AM</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pause(dndPresetUntil("next-week"))}>
              <CalendarClock className="size-4" /> Until next week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setCustom(true)}>
              <CalendarClock className="size-4" /> Custom…
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {dndUntil && paused && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => pause(null)}>
                <BellRing className="size-4" /> Resume notifications
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onOpenSchedule}>
            <Bell className="size-4" /> Notification settings…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomDndDialog open={custom} onOpenChange={setCustom} onPick={(d) => pause(d)} />
    </>
  );
}

/** "Notifications paused until 4:00 PM · Resume" pill under the sidebar header. */
export function DndPill({ onOpenSchedule }: { onOpenSchedule: () => void }) {
  const quiet = useQuietState();
  const { pause } = useDnd();
  if (!quiet.quiet) return null;
  return (
    <div
      role="status"
      className="mx-3 mb-1 flex items-center gap-2 rounded-full bg-side-hover px-3 py-1 text-xs text-side-foreground"
    >
      <BellOff className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {quiet.reason === "dnd" ? `Notifications paused until ${formatUntil(quiet.until)}` : "Outside notification schedule"}
      </span>
      {quiet.reason === "dnd" ? (
        <button onClick={() => pause(null)} className="shrink-0 font-bold text-side-strong hover:underline">
          Resume
        </button>
      ) : (
        <button onClick={onOpenSchedule} className="shrink-0 font-bold text-side-strong hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function CustomDndDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (until: Date) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {open && <CustomDndForm onCancel={() => onOpenChange(false)} onPick={(d) => (onPick(d), onOpenChange(false))} />}
      </DialogContent>
    </Dialog>
  );
}

function CustomDndForm({ onCancel, onPick }: { onCancel: () => void; onPick: (d: Date) => void }) {
  const [now] = useState(() => new Date());
  const [value, setValue] = useState(() => toLocalInput(new Date(now.getTime() + 3 * 3_600_000)));
  const date = value ? new Date(value) : null;
  const valid = !!date && !Number.isNaN(date.getTime()) && date.getTime() > now.getTime() + 30_000;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && date && date.getTime() > Date.now()) onPick(date);
      }}
      className="grid gap-4"
    >
      <DialogHeader>
        <DialogTitle>Pause notifications until…</DialogTitle>
        <DialogDescription>You won&apos;t get desktop notifications or sounds until then.</DialogDescription>
      </DialogHeader>
      <label className="grid gap-1.5 text-sm font-bold">
        Date and time
        <input
          type="datetime-local"
          value={value}
          min={toLocalInput(now)}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 rounded-md border bg-background px-2.5 text-sm font-normal"
          autoFocus
        />
      </label>
      {!valid && value && <p className="-mt-2 text-xs text-destructive">Pick a time in the future.</p>}
      <DialogFooter>
        <button type="button" onClick={onCancel} className="h-9 rounded-md border px-3 text-sm font-bold hover:bg-muted">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="h-9 rounded-md bg-send px-3 text-sm font-bold text-white disabled:opacity-50"
        >
          Pause notifications
        </button>
      </DialogFooter>
    </form>
  );
}

/* --------------------------------------------- Preferences › Notifications */

export function PrefSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        checked ? "bg-send" : "bg-muted-foreground/30",
      )}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-bold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

const LEVELS: { id: NotifyLevel; title: string; note: string }[] = [
  { id: "all", title: "All new messages", note: "Every message in channels you follow." },
  { id: "mentions", title: "Direct messages & mentions", note: "DMs, @you, your groups, @here and @channel." },
  { id: "nothing", title: "Nothing", note: "Badges only. Per-channel settings can still opt in." },
];

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

let tzList: string[] | null = null;
function timeZones(): string[] {
  if (tzList) return tzList;
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    tzList = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    tzList = [];
  }
  if (!tzList.includes("UTC")) tzList = ["UTC", ...tzList];
  return tzList;
}

export function NotificationsSection() {
  const { prefs, update } = useAppearance();
  const permission = useNotificationPermission();
  const quiet = useQuietState();
  const schedule = prefs.notify_schedule;

  const setSchedule = (patch: Partial<NotifySchedule>) =>
    update({
      notify_schedule: {
        enabled: true,
        days: [1, 2, 3, 4, 5],
        start: "09:00",
        end: "18:00",
        tz: localTz(),
        ...schedule,
        ...patch,
      },
    });

  const test = async () => {
    let perm = permission;
    if (perm === "default") perm = await requestNotificationPermission();
    if (prefs.notify_sound) playNotificationSound();
    const shown =
      perm === "granted" &&
      showDesktopNotification("Worklio", { body: "This is what a notification looks like. 🎉", tag: "worklio-test" });
    if (!shown) {
      toast.info(
        perm === "denied"
          ? "Your browser is blocking notifications for Worklio."
          : perm === "unsupported"
            ? "This browser doesn't support desktop notifications."
            : "Notifications aren't enabled yet.",
      );
    } else if (quiet.quiet) {
      toast.info("Test sent. Note: real notifications are paused right now.");
    }
  };

  const zones = timeZones();
  const tz = schedule?.tz ?? localTz();

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading title="Desktop notifications" description="Worklio uses your browser's notifications." />
        <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg",
              permission === "granted" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            )}
          >
            {permission === "granted" ? <BellRing className="size-5" /> : <ShieldAlert className="size-5" />}
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-bold">
              {permission === "granted"
                ? "Notifications are enabled"
                : permission === "denied"
                  ? "Notifications are blocked"
                  : permission === "unsupported"
                    ? "Not supported in this browser"
                    : "Notifications are off"}
            </div>
            <div className="text-muted-foreground">
              {permission === "denied"
                ? "Allow notifications for this site in your browser's site settings, then reload."
                : permission === "granted"
                  ? quiet.quiet
                    ? quiet.reason === "dnd"
                      ? `Paused until ${formatUntil(quiet.until)}.`
                      : "Quiet right now (outside your schedule)."
                    : "You'll be notified based on the settings below."
                  : "Turn them on to hear about DMs and mentions while Worklio is in the background."}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {permission === "default" && (
              <button
                onClick={() => requestNotificationPermission().catch(() => {})}
                className="h-9 rounded-md bg-send px-3 text-sm font-bold text-white"
              >
                Enable
              </button>
            )}
            <button onClick={test} className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-bold hover:bg-muted">
              <Send className="size-3.5" /> Send test
            </button>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Notify me about" description="Applies everywhere unless a channel has its own setting (right-click a channel)." />
        <div role="radiogroup" aria-label="Notify me about" className="grid gap-2">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={prefs.desktop_notify === l.id}
              onClick={() => update({ desktop_notify: l.id })}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                prefs.desktop_notify === l.id ? "border-side-active" : "border-transparent bg-muted/50 hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                  prefs.desktop_notify === l.id ? "border-side-active" : "border-muted-foreground/50",
                )}
              >
                {prefs.desktop_notify === l.id && <span className="size-2 rounded-full bg-send" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold">{l.title}</span>
                <span className="block text-xs text-muted-foreground">{l.note}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Sound" />
        <div className="flex items-center gap-4 rounded-xl border p-4">
          <span className="flex-1">
            <span className="block text-sm font-bold">Play a sound</span>
            <span className="block text-sm text-muted-foreground">A soft chime with each notification.</span>
          </span>
          <button
            onClick={playNotificationSound}
            aria-label="Preview sound"
            title="Preview sound"
            className="flex size-8 items-center justify-center rounded-md border hover:bg-muted"
          >
            <Play className="size-3.5" />
          </button>
          <PrefSwitch checked={prefs.notify_sound} onChange={(v) => update({ notify_sound: v })} label="Play a sound" />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Notification schedule"
          description="Only get notified during these hours. Outside them, Worklio stays quiet (badges still update)."
        />
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex items-center gap-4">
            <span className="flex-1 text-sm font-bold">Use a schedule</span>
            <PrefSwitch
              checked={!!schedule?.enabled}
              onChange={(v) => (v ? setSchedule({ enabled: true }) : update({ notify_schedule: schedule ? { ...schedule, enabled: false } : null }))}
              label="Use a notification schedule"
            />
          </div>
          {schedule?.enabled && (
            <>
              <div>
                <div className="mb-1.5 text-xs font-bold text-muted-foreground uppercase">Days</div>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map((d, i) => {
                    const on = schedule.days.includes(i);
                    return (
                      <button
                        key={i}
                        aria-pressed={on}
                        aria-label={DAY_NAMES[i]}
                        title={DAY_NAMES[i]}
                        onClick={() =>
                          setSchedule({ days: on ? schedule.days.filter((x) => x !== i) : [...schedule.days, i].sort() })
                        }
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full text-sm font-bold transition",
                          on ? "bg-side-active text-side-active-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setSchedule({ days: [1, 2, 3, 4, 5] })}
                    className="h-9 rounded-full border px-3 text-xs font-bold hover:bg-muted"
                  >
                    Weekdays
                  </button>
                  <button
                    onClick={() => setSchedule({ days: [0, 1, 2, 3, 4, 5, 6] })}
                    className="h-9 rounded-full border px-3 text-xs font-bold hover:bg-muted"
                  >
                    Every day
                  </button>
                </div>
                {!schedule.days.length && <p className="mt-1.5 text-xs text-destructive">Pick at least one day, or you won&apos;t get any notifications.</p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs font-bold text-muted-foreground uppercase">
                  From
                  <input
                    type="time"
                    value={schedule.start}
                    onChange={(e) => e.target.value && setSchedule({ start: e.target.value })}
                    className="h-9 rounded-md border bg-background px-2 text-sm font-normal text-foreground normal-case"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-muted-foreground uppercase">
                  To
                  <input
                    type="time"
                    value={schedule.end}
                    onChange={(e) => e.target.value && setSchedule({ end: e.target.value })}
                    className="h-9 rounded-md border bg-background px-2 text-sm font-normal text-foreground normal-case"
                  />
                </label>
                <label className="grid gap-1 text-xs font-bold text-muted-foreground uppercase">
                  Time zone
                  <select
                    value={tz}
                    onChange={(e) => setSchedule({ tz: e.target.value })}
                    className="h-9 min-w-0 rounded-md border bg-background px-2 text-sm font-normal text-foreground normal-case"
                  >
                    {!zones.includes(tz) && <option value={tz}>{tz}</option>}
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {schedule.start > schedule.end && (
                <p className="text-xs text-muted-foreground">Overnight window: notifications run past midnight into the next day.</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
