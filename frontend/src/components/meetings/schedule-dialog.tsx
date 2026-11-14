"use client";

import { AlertTriangle, CalendarPlus, Headphones, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/components/profile/profile-utils";
import { MemberPicker } from "@/components/workspace/member-picker";
import { useWorkspace } from "@/components/workspace/provider";
import { api, type Channel } from "@/lib/api";
import {
  type BusyMap,
  busyDuring,
  dayLabel,
  DURATIONS,
  meetingsApi,
  meetingsChanged,
  type Meeting,
  type MeetingKind,
  suggestSlots,
  timeLabel,
  toBusyMap,
} from "@/lib/meetings";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The next half hour, at least 10 minutes away. */
function nextSlot(): Date {
  const d = new Date(Date.now() + 10 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60);
  return d;
}

/**
 * Schedule (or edit) a huddle. `channelId` fixes where it happens (opened from a channel);
 * without it the dialog asks. `start` pre-fills the time (a click on the calendar grid).
 */
export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  channelId,
  start,
  meeting,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: string;
  start?: Date;
  meeting?: Meeting;
  onSaved?: (m: Meeting) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <ScheduleForm
            channelId={meeting?.channel_id ?? channelId}
            start={start}
            meeting={meeting}
            onDone={(m) => {
              onOpenChange(false);
              if (m) onSaved?.(m);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  channelId: fixedChannel,
  start,
  meeting,
  onDone,
}: {
  channelId?: string;
  start?: Date;
  meeting?: Meeting;
  onDone: (m?: Meeting) => void;
}) {
  const { me, members, channels, channelLabel, workspaceId, memberById, reloadChannels } = useWorkspace();
  const now = useNow();
  const editing = !!meeting;
  const initialStart = meeting ? new Date(meeting.starts_at) : start ?? nextSlot();
  const initialLength = meeting
    ? Math.round((new Date(meeting.ends_at).getTime() - new Date(meeting.starts_at).getTime()) / 60_000)
    : 30;

  const [title, setTitle] = useState(meeting?.title ?? "");
  const [description, setDescription] = useState(meeting?.description ?? "");
  const [date, setDate] = useState(dateInput(initialStart));
  const [time, setTime] = useState(timeInput(initialStart));
  const [length, setLength] = useState(initialLength);
  const [kind, setKind] = useState<MeetingKind>(meeting?.kind ?? "audio");
  const [channelId, setChannelId] = useState(fixedChannel ?? "");
  const [people, setPeople] = useState<string[]>(
    meeting ? meeting.attendees.map((a) => a.user_id).filter((id) => id !== meeting.organizer_id) : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const myChannels = useMemo(
    () =>
      channels
        .filter((c) => c.is_member && !c.is_archived)
        .sort((a, b) => Number(a.kind === "dm") - Number(b.kind === "dm") || channelLabel(a).localeCompare(channelLabel(b))),
    [channels, channelLabel],
  );
  const channel = channels.find((c) => c.id === channelId);
  const isDM = channel?.kind === "dm";
  const restricted = channel && channel.kind !== "public";
  const allowed = restricted && channel.member_ids?.length ? new Set(channel.member_ids) : null;
  const exclude = members
    .filter((m) => m.user_id === me?.id || m.is_bot || (allowed !== null && !allowed.has(m.user_id)))
    .map((m) => m.user_id);
  const where = channel ? (isDM ? channelLabel(channel) : `#${channel.name}`) : null;

  // --- Free/busy for me + guests: suggestions and clash warnings (times only, no titles). ---
  const [freeBusy, setFreeBusy] = useState<BusyMap | null>(null);
  const everyone = useMemo(() => [...new Set([...(me ? [me.id] : []), ...people])], [me, people]);
  const busyKey = everyone.join(",");
  useEffect(() => {
    if (!everyone.length) return;
    let live = true;
    const t = window.setTimeout(() => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 14 * 86_400_000);
      const own = meeting ? ([new Date(meeting.starts_at).getTime(), new Date(meeting.ends_at).getTime()] as [number, number]) : undefined;
      meetingsApi
        .busy(workspaceId, everyone, from, to)
        .then((rows) => live && setFreeBusy(toBusyMap(rows, own)))
        .catch(() => live && setFreeBusy(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // busyKey stands in for `everyone` (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyKey, workspaceId, meeting]);

  const chosenStart = new Date(`${date}T${time}`).getTime();
  const clashIds =
    freeBusy && !Number.isNaN(chosenStart) ? busyDuring(freeBusy, everyone, chosenStart, chosenStart + length * 60_000) : [];
  const clashNames = clashIds.map((id) => (id === me?.id ? "You" : (memberById[id]?.full_name.split(" ")[0] ?? "Someone")));
  const suggestions = freeBusy && people.length ? suggestSlots(freeBusy, everyone, length, now, now, 4) : [];

  const lengths = DURATIONS.includes(length as (typeof DURATIONS)[number]) ? DURATIONS : [...DURATIONS, length].sort((a, b) => a - b);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const startsAt = new Date(`${date}T${time}`);
    if (!title.trim()) return setError("Give the meeting a name.");
    if (!channelId && !people.length) return setError("Add at least one guest, or choose a channel.");
    if (Number.isNaN(startsAt.getTime())) return setError("Pick a date and time.");
    if (!editing && startsAt.getTime() < Date.now() - 5 * 60_000) return setError("Pick a time in the future.");
    const endsAt = new Date(startsAt.getTime() + length * 60_000);
    const body = {
      title: title.trim(),
      description: description.trim(),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      kind,
      attendee_ids: people,
    };
    setBusy(true);
    try {
      // No channel picked: the huddle happens in a DM (or group DM) with the guests, like a calendar invite.
      let target = channelId;
      if (!meeting && !target) {
        const dm = await api<Channel>(`/workspaces/${workspaceId}/dms`, {
          method: "POST",
          body: JSON.stringify({ user_ids: people }),
        });
        await reloadChannels().catch(() => {});
        target = dm.id;
      }
      const saved = meeting ? await meetingsApi.update(meeting.id, body) : await meetingsApi.create(target, body);
      meetingsChanged(saved);
      toast.success(editing ? "Meeting updated" : "Meeting scheduled");
      onDone(saved);
    } catch (err) {
      setError(errorMessage(err, "Could not save the meeting"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarPlus className="size-4" aria-hidden />
          {editing ? "Edit meeting" : "Schedule a huddle"}
        </DialogTitle>
        <DialogDescription>
          {where
            ? `It happens in ${where}. Guests get an invite, a reminder 10 minutes before and a ring when it starts.`
            : "Guests get an invite they can accept or decline, a reminder 10 minutes before and a ring when it starts."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="meeting-title">Name</Label>
        <Input
          id="meeting-title"
          autoFocus
          maxLength={200}
          placeholder="Weekly sync"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <span className="text-sm leading-none font-medium select-none">Guests</span>
        <MemberPicker selected={people} onChange={setPeople} exclude={exclude} />
        {isDM && !people.length && (
          <p className="text-xs text-muted-foreground">Pick no one to invite everyone in this DM.</p>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="meeting-date">Date</Label>
          <Input id="meeting-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="meeting-time">Time</Label>
          <Input id="meeting-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="meeting-length">Length</Label>
          <select
            id="meeting-length"
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            {lengths.map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {clashNames.length > 0 && (
        <p role="status" className="-mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {clashNames.length === 1
            ? `${clashNames[0]} ${clashNames[0] === "You" ? "have" : "has"} another meeting then.`
            : `${clashNames.slice(0, -1).join(", ")} and ${clashNames[clashNames.length - 1]} have other meetings then.`}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="-mt-1 grid gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Everyone is free
          </span>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((d) => {
              const picked = d.getTime() === chosenStart;
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    setDate(dateInput(d));
                    setTime(timeInput(d));
                  }}
                  className={cn(
                    "h-7 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    picked ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {dayLabel(d, new Date(now))} · {timeLabel(d)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-1.5">
        <span className="text-sm leading-none font-medium select-none">Huddle type</span>
        <div role="radiogroup" aria-label="Huddle type" className="flex gap-2">
          {(
            [
              ["audio", Headphones, "Audio"],
              ["video", Video, "Video"],
            ] as const
          ).map(([k, Icon, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                kind === k ? "border-primary bg-primary/10 font-semibold" : "border-input hover:bg-muted",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {!fixedChannel && (
        <div className="grid gap-1.5">
          <Label htmlFor="meeting-channel">Post it in</Label>
          <select
            id="meeting-channel"
            value={channelId}
            onChange={(e) => {
              const next = channels.find((c) => c.id === e.target.value);
              setChannelId(e.target.value);
              // A private channel or DM can only include its members.
              if (next && next.kind !== "public" && next.member_ids?.length) {
                const ok = new Set(next.member_ids);
                setPeople((p) => p.filter((id) => ok.has(id)));
              }
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">A direct message with the guests</option>
            {myChannels
              .filter((c) => c.kind !== "dm")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  # {c.name}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="meeting-description">Agenda (optional)</Label>
        <Textarea
          id="meeting-description"
          rows={3}
          maxLength={4000}
          placeholder="What do you want to cover?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Schedule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
