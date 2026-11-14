/**
 * Calendar: scheduled meetings (a huddle booked for a time in a channel or DM).
 * Mirrors backend/app/api/routes/meetings.py.
 */

import { API_URL, api, freshToken } from "@/lib/api";

export type RSVPResponse = "pending" | "accepted" | "tentative" | "declined";
export type MeetingKind = "audio" | "video";

export type MeetingAttendee = { user_id: string; response: RSVPResponse };

export type Meeting = {
  id: string;
  workspace_id: string;
  channel_id: string;
  organizer_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  kind: MeetingKind;
  status: "scheduled" | "cancelled";
  message_id: string | null;
  attendees: MeetingAttendee[];
};

export type MeetingInput = {
  title: string;
  description?: string;
  starts_at: string;
  ends_at: string;
  kind: MeetingKind;
  attendee_ids: string[];
};

export type MeetingRealtimeEvent =
  | { type: "meeting.updated"; meeting: Meeting }
  | { type: "meeting.starting"; meeting: Meeting; notify: boolean };

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const meetingsApi = {
  create: (channelId: string, data: MeetingInput) =>
    api<Meeting>(`/channels/${channelId}/meetings`, json("POST", data)),
  update: (id: string, data: Partial<MeetingInput>) => api<Meeting>(`/meetings/${id}`, json("PATCH", data)),
  cancel: (id: string) => api<Meeting>(`/meetings/${id}/cancel`, json("POST")),
  rsvp: (id: string, response: Exclude<RSVPResponse, "pending">) =>
    api<Meeting>(`/meetings/${id}/rsvp`, json("PUT", { response })),
  get: (id: string) => api<Meeting>(`/meetings/${id}`),
  range: (workspaceId: string, start: Date, end: Date) =>
    api<Meeting[]>(
      `/workspaces/${workspaceId}/meetings?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    ),
};

/** Download the meeting as an .ics file (Google Calendar, Outlook, Apple Calendar). */
export async function downloadIcs(meeting: Pick<Meeting, "id" | "title">): Promise<void> {
  const token = await freshToken();
  const res = await fetch(`${API_URL}/meetings/${meeting.id}/ics`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Could not download the calendar file");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${meeting.title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "meeting"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Add to Google Calendar" link (opens a prefilled event; no account linking needed). */
export function googleCalendarUrl(m: Meeting, link: string): string {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: m.title,
    dates: `${fmt(m.starts_at)}/${fmt(m.ends_at)}`,
    details: `${m.description ? `${m.description}\n\n` : ""}Join the huddle in Worklio: ${link}`,
    location: "Worklio huddle",
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// --- Time helpers ---------------------------------------------------------------------------

export const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

export function myResponse(m: Meeting, userId: string | undefined): RSVPResponse | null {
  return m.attendees.find((a) => a.user_id === userId)?.response ?? null;
}

export function isLive(m: Meeting, now = Date.now()): boolean {
  return m.status === "scheduled" && new Date(m.starts_at).getTime() <= now && now < new Date(m.ends_at).getTime();
}

export function isOver(m: Meeting, now = Date.now()): boolean {
  return new Date(m.ends_at).getTime() <= now;
}

/** "Today", "Tomorrow" or "Mon, 17 Nov". */
export function dayLabel(d: Date, now = new Date()): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today · 3:00 – 3:30 PM" */
export function whenLabel(m: Pick<Meeting, "starts_at" | "ends_at">): string {
  const s = new Date(m.starts_at);
  const e = new Date(m.ends_at);
  return `${dayLabel(s)} · ${timeLabel(s)} – ${timeLabel(e)}`;
}

/** "in 5 min", "in 2 h", "now" */
export function relativeStart(m: Pick<Meeting, "starts_at">, now = Date.now()): string {
  const mins = Math.round((new Date(m.starts_at).getTime() - now) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.round(mins / 60);
  if (h < 24) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

/** Monday 00:00 of the week containing `d` (local time). */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Fire after any meeting change so open calendars refresh. */
export const MEETINGS_CHANGED = "worklio:meetings-changed";
export function meetingsChanged(m?: Meeting) {
  window.dispatchEvent(new CustomEvent(MEETINGS_CHANGED, { detail: m }));
}
