"use client";

import type { Room } from "livekit-client";
import { Hand, Mic, MicOff, PhoneCall, PhoneOff, ScreenShare, Search, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { UserAvatar } from "@/components/chat/user-avatar";
import { useWorkspace } from "@/components/workspace/provider";
import { api } from "@/lib/api";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { SpeakingBars } from "../huddle-button";
import { NameWithYou, useParticipantName } from "../participant-tile";
import type { HuddleParticipantView, HuddleRoomSnapshot } from "../types";
import { cancelRinging } from "./call-api";
import { getCallSignals, type CallSignalsSnapshot } from "./signals";
import type { CallInviteStatus, CallOut } from "./types";

const INVITE_LABEL: Partial<Record<CallInviteStatus, string>> = {
  ringing: "Ringing…",
  declined: "Declined",
  missed: "No answer",
  cancelled: "Cancelled",
};

export function PeoplePanel({
  channelId,
  snap,
  signals,
  call,
  invite,
  canInvite,
  room,
}: {
  room: Room | null;
  channelId: string;
  snap: HuddleRoomSnapshot;
  signals: CallSignalsSnapshot;
  call: CallOut | null;
  invite: (ids: string[]) => Promise<void>;
  canInvite: boolean;
}) {
  const { members, memberById, channels, online, me } = useWorkspace();
  const channel = channels.find((c) => c.id === channelId);
  const [channelMembers, setChannelMembers] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    api<string[]>(`/channels/${channelId}/members`)
      .then((ids) => live && setChannelMembers(ids))
      .catch(() => live && setChannelMembers(null));
    return () => {
      live = false;
    };
  }, [channelId]);

  const inCall = useMemo(() => {
    const list = [...snap.participants];
    return list.sort((a, b) => {
      const ha = signals.hands[a.identity];
      const hb = signals.hands[b.identity];
      if (ha && hb) return ha - hb;
      if (ha) return -1;
      if (hb) return 1;
      return 0;
    });
  }, [snap.participants, signals.hands]);

  const presentIds = new Set(snap.participants.map((p) => p.identity));
  const invites = (call?.invites ?? []).filter((i) => !presentIds.has(i.user_id) && i.status !== "accepted");
  const ringing = invites.filter((i) => i.status === "ringing");
  const ringingIds = new Set(ringing.map((i) => i.user_id));

  // Private channels: members only. A DM can take anyone; adding them moves the call to a group DM.
  const restricted = channel?.kind === "private";
  const isDM = channel?.kind === "dm";
  const memberSet = channelMembers ? new Set(channelMembers) : null;
  const needle = q.trim().toLowerCase();
  const candidates = members
    .filter((m) => m.user_id !== me?.id && !presentIds.has(m.user_id) && !ringingIds.has(m.user_id))
    .filter((m) => !restricted || !memberSet || memberSet.has(m.user_id))
    .filter((m) => !needle || m.full_name.toLowerCase().includes(needle) || m.email?.toLowerCase().includes(needle))
    .sort((a, b) => {
      // Channel members first, then people who are online.
      const ca = memberSet?.has(a.user_id) ? 0 : 1;
      const cb = memberSet?.has(b.user_id) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const oa = online.has(a.user_id) ? 0 : 1;
      const ob = online.has(b.user_id) ? 0 : 1;
      return oa - ob || a.full_name.localeCompare(b.full_name);
    })
    .slice(0, 50);

  async function ring(userId: string) {
    setBusy((b) => ({ ...b, [userId]: true }));
    try {
      await invite([userId]);
      toast.success(`Ringing ${memberById[userId]?.full_name ?? "them"}…`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't invite them"));
    } finally {
      setBusy((b) => ({ ...b, [userId]: false }));
    }
  }

  async function stopRinging() {
    if (!call) return;
    try {
      await cancelRinging(call.id);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't stop ringing"));
    }
  }

  const handQueue = Object.entries(signals.hands)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {handQueue.length > 0 && (
        <Section title={`Raised hands · ${handQueue.length}`}>
          <ol className="flex flex-col gap-1 px-2 pb-2">
            {handQueue.map((id, i) => {
              const mine = id === me?.id;
              const fullName = memberById[id]?.full_name ?? (mine ? (me?.full_name ?? "You") : "Someone");
              const name = mine ? "You" : fullName;
              return (
                <li
                  key={id}
                  className="flex items-center gap-2.5 rounded-xl bg-amber-400/10 px-2 py-1.5 ring-1 ring-amber-300/20 animate-in fade-in-0 slide-in-from-top-1 duration-200"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold text-amber-950 tabular-nums">
                    {i + 1}
                  </span>
                  <UserAvatar id={id} name={fullName} size="md" />
                  <span className="min-w-0 flex-1 truncate text-sm text-white">{name}</span>
                  {mine && room ? (
                    <button
                      type="button"
                      onClick={() => getCallSignals(room).setHand(false)}
                      className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      Lower
                    </button>
                  ) : (
                    <Hand className="size-4 text-amber-300" aria-label="Hand raised" />
                  )}
                </li>
              );
            })}
          </ol>
        </Section>
      )}
      <Section title={`In the call · ${inCall.length}`}>
        <ul className="flex flex-col">
          {inCall.map((p) => (
            <ParticipantRow key={p.identity} p={p} hand={p.identity in signals.hands} />
          ))}
        </ul>
      </Section>

      {invites.length > 0 && (
        <Section
          title="Invited"
          action={
            ringing.length > 0 && call ? (
              <button
                type="button"
                onClick={() => void stopRinging()}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-red-600 outline-none hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-red-500/40 dark:text-red-400"
              >
                <PhoneOff className="size-3" aria-hidden /> Stop ringing
              </button>
            ) : undefined
          }
        >
          <ul className="flex flex-col">
            {invites.map((i) => {
              const name = memberById[i.user_id]?.full_name ?? "Someone";
              const isRinging = i.status === "ringing";
              return (
                <li key={i.user_id} className="flex items-center gap-2.5 px-3 py-1.5">
                  <span className="relative">
                    {isRinging && (
                      <span aria-hidden className="absolute -inset-1 animate-ping rounded-lg bg-emerald-500/25 motion-reduce:animate-none" />
                    )}
                    <UserAvatar id={i.user_id} name={name} size="md" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs",
                      isRinging ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                    )}
                  >
                    {isRinging && <PhoneCall className="size-3" aria-hidden />}
                    {INVITE_LABEL[i.status] ?? i.status}
                  </span>
                  {!isRinging && canInvite && (
                    <RingButton busy={!!busy[i.user_id]} onClick={() => void ring(i.user_id)} label={`Ring ${name} again`} again />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {canInvite && (
        <Section title="Invite to the call">
          <div className="px-3 pb-2">
            <label className="relative block">
              <span className="sr-only">Search people to invite</span>
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search people"
                className="h-8 w-full rounded-lg border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </label>
          </div>
          {isDM && (
            <p className="px-3 pb-2 text-[11px] leading-snug text-muted-foreground">
              Adding someone new moves this call to a group conversation with everyone.
            </p>
          )}
          <ul className="flex flex-col pb-3">
            {candidates.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">{needle ? "No matches." : "Everyone is already here."}</li>
            )}
            {candidates.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2.5 px-3 py-1.5">
                <UserAvatar id={m.user_id} name={m.full_name} size="md" online={online.has(m.user_id)} ringClassName="border-popover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.full_name}</span>
                  {memberSet && !memberSet.has(m.user_id) && (
                    <span className="block truncate text-[11px] text-muted-foreground">{isDM ? "Not in this conversation" : "Not in this channel"}</span>
                  )}
                </span>
                <RingButton busy={!!busy[m.user_id]} onClick={() => void ring(m.user_id)} label={`Ring ${m.full_name}`} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-b border-white/[0.06] last:border-b-0">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <h3 className="text-[11px] font-bold tracking-wider text-white/45 uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function RingButton({ busy, onClick, label, again }: { busy: boolean; onClick: () => void; label: string; again?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-emerald-600 px-2.5 text-xs font-semibold text-white outline-none transition hover:bg-emerald-700 focus-visible:ring-3 focus-visible:ring-emerald-500/40 active:translate-y-px disabled:opacity-50"
    >
      <PhoneCall className="size-3" aria-hidden />
      {again ? "Again" : "Ring"}
    </button>
  );
}

function ParticipantRow({ p, hand }: { p: HuddleParticipantView; hand: boolean }) {
  const { name } = useParticipantName(p);
  return (
    <li className="group flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors hover:bg-white/[0.04]">
      <span
        className={cn(
          "rounded-[9px] ring-2 ring-transparent ring-offset-2 ring-offset-[var(--popover)] transition-[--tw-ring-color] duration-150",
          p.speaking && "ring-emerald-400",
        )}
      >
        <UserAvatar id={p.identity} name={name} size="md" />
      </span>
      <span className="min-w-0 flex-1">
        <NameWithYou name={name} isLocal={p.isLocal} className="text-sm text-white [&>span:last-child]:text-xs [&>span:last-child]:text-white/50" />
        {(p.screenTrack || p.speaking) && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-300">
            {p.screenTrack ? (
              <>
                <ScreenShare className="size-3" aria-hidden /> Presenting
              </>
            ) : (
              <>
                <SpeakingBars className="h-2.5" /> Speaking
              </>
            )}
          </span>
        )}
      </span>
      <span className="flex items-center gap-1 text-white/55">
        {hand && (
          <span className="flex size-6 items-center justify-center rounded-full bg-amber-400 text-amber-950" title="Hand raised">
            <Hand className="size-3.5" aria-label="Hand raised" />
          </span>
        )}
        <StateIcon on={!!p.cameraTrack} onIcon={Video} offIcon={VideoOff} label={p.cameraTrack ? "Camera on" : "Camera off"} />
        <StateIcon on={p.micEnabled} onIcon={Mic} offIcon={MicOff} label={p.micEnabled ? "Mic on" : "Muted"} />
      </span>
    </li>
  );
}

function StateIcon({
  on,
  onIcon: On,
  offIcon: Off,
  label,
}: {
  on: boolean;
  onIcon: React.ComponentType<{ className?: string }>;
  offIcon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex size-6 items-center justify-center rounded-full", on ? "text-white/70" : "bg-red-500/15 text-red-300")}
    >
      {on ? <On className="size-3.5" /> : <Off className="size-3.5" />}
    </span>
  );
}
