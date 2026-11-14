"use client";

import { CalendarPlus, Headphones, Video } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MemberPicker } from "@/components/workspace/member-picker";
import { useWorkspace } from "@/components/workspace/provider";
import { DURATIONS, meetingsApi, meetingsChanged, type Meeting, type MeetingKind } from "@/lib/meetings";
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
  const { me, members, channels, channelLabel } = useWorkspace();
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

  const lengths = DURATIONS.includes(length as (typeof DURATIONS)[number]) ? DURATIONS : [...DURATIONS, length].sort((a, b) => a - b);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    const startsAt = new Date(`${date}T${time}`);
    if (!title.trim()) return setError("Give the meeting a name.");
    if (!channelId) return setError("Choose where the huddle happens.");
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
      const saved = meeting ? await meetingsApi.update(meeting.id, body) : await meetingsApi.create(channelId, body);
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
            ? `It happens in ${where}. Everyone you invite gets a reminder 10 minutes before and a ring when it starts.`
            : "Everyone you invite gets a reminder 10 minutes before and a ring when it starts."}
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

      {!fixedChannel && (
        <div className="grid gap-1.5">
          <Label htmlFor="meeting-channel">Where</Label>
          <select
            id="meeting-channel"
            value={channelId}
            onChange={(e) => {
              setChannelId(e.target.value);
              setPeople([]);
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          >
            <option value="">Choose a channel or DM…</option>
            {myChannels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === "dm" ? channelLabel(c) : `# ${c.name}`}
              </option>
            ))}
          </select>
        </div>
      )}

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

      {channel && (
        <div className="grid gap-1.5">
          <span className="text-sm leading-none font-medium select-none">
            Invite people{isDM && !people.length ? " (everyone in this DM if you pick no one)" : ""}
          </span>
          <MemberPicker selected={people} onChange={setPeople} exclude={exclude} />
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
