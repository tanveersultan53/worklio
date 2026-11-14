"use client";

import { CalendarPlus, ChevronDown, Headphones, LoaderCircle, Phone, UserPlus, Video } from "lucide-react";
import { useEffect, useState } from "react";

import { SpeakingBars } from "@/components/huddle/huddle-button";
import { useHuddleRoom, useHuddles } from "@/components/huddle/huddle-provider";
import { ScheduleMeetingDialog } from "@/components/meetings/schedule-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MemberPicker } from "@/components/workspace/member-picker";
import { useWorkspace } from "@/components/workspace/provider";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CallAvatarStack } from "./avatar-stack";
import { useCalls } from "./call-provider";
import { isSelfDM } from "./call-styles";
import type { CallKind } from "./types";

/**
 * Channel-header call controls.
 * - DM: audio + video icon buttons.
 * - Channel: split "Huddle" button (start / start with video / ring people…).
 * - A call in progress: "Join" with avatars + count; in it: "Leave" + "Ring someone".
 */
export function CallButtons({ channelId, isDM, className }: { channelId: string; isDM: boolean; className?: string }) {
  const { huddles, calls, activeChannelId, status, callKind, startCall, leave } = useHuddles();
  const { incoming, accept } = useCalls();
  const { channels, me } = useWorkspace();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const channel = channels.find((c) => c.id === channelId);
  const selfDM = isSelfDM(channel, me?.id);
  const archived = channel?.is_archived ?? false;
  const inThis = activeChannelId === channelId;
  const live = calls[channelId];
  const participants = huddles[channelId]?.participant_ids ?? live?.participant_ids ?? [];
  const ringingForMe = incoming.find((r) => r.call.channel_id === channelId);

  // Notes-to-self DM: there's nobody to call.
  if (selfDM && !inThis) return null;

  const inviteDialog = (
    <>
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} channelId={channelId} inCall={inThis} />
      <ScheduleMeetingDialog open={scheduleOpen} onOpenChange={setScheduleOpen} channelId={channelId} />
    </>
  );

  if (inThis) {
    const connecting = status === "connecting";
    const isVideo = callKind === "video";
    return (
      <div className={cn("flex shrink-0 items-center gap-1", className)}>
        <Button
          size="sm"
          onClick={leave}
          aria-label={connecting ? "Cancel joining the call" : "Leave the call"}
          className="gap-1.5 rounded-full bg-emerald-600 pr-3 text-white shadow-sm hover:bg-red-600 dark:bg-emerald-600 dark:hover:bg-red-600"
        >
          {connecting ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <LiveIcon video={isVideo} />
          )}
          <span>{connecting ? "Joining…" : "Leave"}</span>
        </Button>
        {!connecting && (
          <IconAction label="Ring someone into this call" onClick={() => setInviteOpen(true)}>
            <UserPlus />
          </IconAction>
        )}
        {inviteDialog}
      </div>
    );
  }

  if (participants.length || ringingForMe) {
    const shown = participants;
    const kind: CallKind = live?.kind ?? ringingForMe?.call.kind ?? "audio";
    const join = () => {
      if (ringingForMe) void accept(ringingForMe.call.id, kind === "video");
      else void startCall(channelId, kind);
    };
    const KindIcon = kind === "video" ? Video : isDM ? Phone : Headphones;
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={archived}
        onClick={join}
        aria-label={`Join ${kind === "video" ? "video call" : isDM ? "call" : "huddle"} with ${participants.length} ${participants.length === 1 ? "person" : "people"}`}
        className={cn(
          "wk-call-live shrink-0 gap-1.5 rounded-full border-emerald-500/50 bg-emerald-500/10 pr-3 pl-1.5 text-emerald-800 hover:bg-emerald-500/20 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20",
          className,
        )}
      >
        {shown.length > 0 && (
          <CallAvatarStack ids={shown} size="sm" max={3} ringClassName="ring-background" className="pointer-events-none" />
        )}
        <KindIcon aria-hidden />
        <span className="tabular-nums">{participants.length || 1}</span>
        <span className="hidden sm:inline">· Join</span>
      </Button>
    );
  }

  if (isDM) {
    return (
      <div className={cn("flex shrink-0 items-center gap-0.5", className)}>
        <IconAction label="Start an audio call" disabled={archived} onClick={() => void startCall(channelId, "audio")}>
          <Phone />
        </IconAction>
        <IconAction label="Start a video call" disabled={archived} onClick={() => void startCall(channelId, "video")}>
          <Video />
        </IconAction>
        <IconAction label="Schedule a call" disabled={archived} onClick={() => setScheduleOpen(true)}>
          <CalendarPlus />
        </IconAction>
        {inviteDialog}
      </div>
    );
  }

  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <div className="flex items-center rounded-lg ring-1 ring-border ring-inset">
        <Button
          size="sm"
          variant="ghost"
          disabled={archived}
          onClick={() => void startCall(channelId, "audio", [])}
          aria-label="Start a huddle"
          title={archived ? "This channel is archived" : "Start a huddle"}
          className="gap-1.5 rounded-r-none"
        >
          <Headphones aria-hidden />
          <span className="hidden sm:inline">Huddle</span>
        </Button>
        <span className="h-4 w-px bg-border" aria-hidden />
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={archived}
            render={
              <Button size="icon-sm" variant="ghost" aria-label="More huddle options" className="w-6 rounded-l-none" />
            }
          >
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => void startCall(channelId, "audio", [])}>
              <Headphones />
              Start huddle
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void startCall(channelId, "video", [])}>
              <Video />
              Start video huddle
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite people…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
              <CalendarPlus />
              Schedule a huddle…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {inviteDialog}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Mic/camera glyph that turns into equalizer bars while someone speaks. */
function LiveIcon({ video }: { video: boolean }) {
  const { speakingIds } = useHuddleRoom();
  if (speakingIds.length) return <SpeakingBars className="h-3.5" />;
  return video ? <Video aria-hidden /> : <Headphones aria-hidden />;
}

/** Pick people to ring into this channel's call (starting one if needed). */
function InviteDialog({
  open,
  onOpenChange,
  channelId,
  inCall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  inCall: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <InviteForm channelId={channelId} inCall={inCall} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ channelId, inCall, onDone }: { channelId: string; inCall: boolean; onDone: () => void }) {
  const { startCall, inviteToCall, huddles, call } = useHuddles();
  const { me, members, channels, channelLabel } = useWorkspace();
  const channel = channels.find((c) => c.id === channelId);
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<CallKind>("audio");
  const [busy, setBusy] = useState(false);
  const [channelMembers, setChannelMembers] = useState<string[] | null>(null);

  const restricted = channel?.kind === "private" || channel?.kind === "dm";
  useEffect(() => {
    if (!restricted) return;
    let cancelled = false;
    api<string[]>(`/channels/${channelId}/members`)
      .then((ids) => {
        if (!cancelled) setChannelMembers(ids);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, restricted]);

  const inCallIds = new Set([...(huddles[channelId]?.participant_ids ?? []), ...(call?.participant_ids ?? [])]);
  const allowed = restricted && channelMembers ? new Set(channelMembers) : null;
  const exclude = members
    .filter(
      (m) =>
        m.user_id === me?.id ||
        inCallIds.has(m.user_id) ||
        (allowed !== null && !allowed.has(m.user_id)) ||
        (restricted && channelMembers === null),
    )
    .map((m) => m.user_id);

  const where = channel ? (channel.kind === "dm" ? channelLabel(channel) : `#${channel.name}`) : "this channel";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected.length || busy) return;
    setBusy(true);
    try {
      if (inCall) await inviteToCall(selected);
      else await startCall(channelId, kind, selected);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{inCall ? "Ring someone into this call" : "Start a call and ring people"}</DialogTitle>
        <DialogDescription>
          {inCall
            ? "They'll get a ringing call they can pick up from anywhere in Worklio."
            : `A ${kind === "video" ? "video" : "audio"} huddle starts in ${where} and rings everyone you pick.`}
        </DialogDescription>
      </DialogHeader>

      {!inCall && (
        <div role="radiogroup" aria-label="Call type" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["audio", "video"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium text-muted-foreground transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                kind === k && "bg-background text-foreground shadow-sm",
              )}
            >
              {k === "video" ? <Video className="size-4" aria-hidden /> : <Headphones className="size-4" aria-hidden />}
              {k === "video" ? "Video" : "Audio"}
            </button>
          ))}
        </div>
      )}

      <MemberPicker selected={selected} onChange={setSelected} exclude={exclude} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={!selected.length || busy}
          className="bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Phone aria-hidden />}
          {selected.length ? `Ring ${selected.length} ${selected.length === 1 ? "person" : "people"}` : "Ring"}
        </Button>
      </DialogFooter>
    </form>
  );
}
