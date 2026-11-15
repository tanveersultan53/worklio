"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useNow } from "@/components/profile/profile-utils";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/provider";
import { MEETINGS_CHANGED, type Meeting, meetingsApi, meetingsChanged, myResponse, type RSVPResponse } from "@/lib/meetings";
import { errorMessage, toast } from "@/lib/toast";

const ANSWERS = [
  ["accepted", "Yes", Check],
  ["tentative", "Maybe", null],
  ["declined", "No", X],
] as const;

const DONE: Record<Exclude<RSVPResponse, "pending">, string> = {
  accepted: "You're going",
  tentative: "You said maybe",
  declined: "You declined",
};

/** "Going? Yes · Maybe · No" right on a meeting invite (Activity), like a calendar invite. */
export function InviteRsvp({ meetingId }: { meetingId: string }) {
  const { me } = useWorkspace();
  const now = useNow();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    meetingsApi
      .get(meetingId)
      .then((m) => live && setMeeting(m))
      .catch(() => {});
    const on = (e: Event) => {
      const m = (e as CustomEvent<Meeting | undefined>).detail;
      if (m?.id === meetingId) setMeeting(m);
    };
    window.addEventListener(MEETINGS_CHANGED, on);
    return () => {
      live = false;
      window.removeEventListener(MEETINGS_CHANGED, on);
    };
  }, [meetingId]);

  if (!meeting || meeting.organizer_id === me?.id) return null;
  if (meeting.status === "cancelled") return <p className="mt-1.5 text-xs font-medium text-muted-foreground">This meeting was cancelled.</p>;
  if (new Date(meeting.ends_at).getTime() < now) return null;
  const mine = myResponse(meeting, me?.id);

  async function answer(r: Exclude<RSVPResponse, "pending">) {
    setBusy(true);
    try {
      const m = await meetingsApi.rsvp(meetingId, r);
      setMeeting(m);
      meetingsChanged(m);
      toast.success(DONE[r]);
    } catch (err) {
      toast.error(errorMessage(err, "Could not save your answer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Are you going?" className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Going?</span>
      {ANSWERS.map(([r, label, Icon]) => (
        <Button
          key={r}
          type="button"
          size="xs"
          variant={mine === r ? "default" : "outline"}
          aria-pressed={mine === r}
          disabled={busy}
          onClick={() => void answer(r)}
          className="gap-1"
        >
          {Icon && <Icon aria-hidden />}
          {label}
        </Button>
      ))}
    </div>
  );
}
