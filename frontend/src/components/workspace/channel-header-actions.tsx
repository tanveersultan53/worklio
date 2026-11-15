"use client";

import { Bell, BellOff, Check, Link2, MoreVertical, Puzzle, Search, Settings, Star, Users } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Channel } from "@/lib/api";
import { type ChannelNotifyLevel, defaultPref, updateChannelPref, useSidebarState } from "@/lib/sidebar";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import type { DetailsTab } from "./channel-details";

/**
 * Slack-style channel header controls: ☆ star (before the name), 👤 member count, 🔔 this
 * channel's notifications, 🔍 search in channel and ⋮ more. Star / notifications / mute use the
 * same per-channel sidebar preferences as the sidebar's own menus, so both stay in sync.
 */

const iconBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-lg border text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-popup-open:bg-muted";

function usePref(channelId: string) {
  const s = useSidebarState();
  return s.prefs[channelId] ?? defaultPref(channelId);
}

async function save(channelId: string, patch: Parameters<typeof updateChannelPref>[1], done: string) {
  try {
    const ok = await updateChannelPref(channelId, patch);
    if (ok) toast.success(done);
    else toast.error("Couldn't save that. Try again.");
  } catch (err) {
    toast.error(errorMessage(err, "Couldn't save that. Try again."));
  }
}

export function StarButton({ channel, label }: { channel: Channel; label: string }) {
  const pref = usePref(channel.id);
  const starred = pref.starred;
  return (
    <button
      type="button"
      onClick={() => void save(channel.id, { starred: !starred }, starred ? `Removed ${label} from Starred` : `Starred ${label}`)}
      aria-pressed={starred}
      aria-label={starred ? `Unstar ${label}` : `Star ${label}`}
      className={cn(
        "hidden size-8 shrink-0 items-center justify-center rounded-lg border outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex",
        starred ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Star className={cn("size-4", starred && "fill-current")} aria-hidden />
    </button>
  );
}

export function MemberCountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${count} ${count === 1 ? "member" : "members"}`}
      className="hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-bold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 sm:flex"
    >
      <Users className="size-4" aria-hidden />
      {count}
    </button>
  );
}

const LEVELS: { id: ChannelNotifyLevel; label: string; hint: string }[] = [
  { id: "default", label: "Use my default", hint: "Follows Preferences → Notifications" },
  { id: "all", label: "All new messages", hint: "Notify me about every message" },
  { id: "mentions", label: "Mentions only", hint: "DMs, @mentions and @here / @channel" },
  { id: "nothing", label: "Nothing", hint: "Never notify me here" },
];

export function ChannelBell({ channel, label }: { channel: Channel; label: string }) {
  const pref = usePref(channel.id);
  const quiet = pref.muted || pref.notify === "nothing";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Notifications for ${label}`}
        className={cn(iconBtn, "hidden sm:flex", quiet && "text-foreground")}
      >
        {quiet ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* A menu label must sit inside a group, or the menu throws when it opens. */}
        <DropdownMenuGroup>
        <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
        {LEVELS.map((l) => (
          <DropdownMenuItem
            key={l.id}
            onClick={() => void save(channel.id, { notify: l.id }, `Notifications for ${label}: ${l.label.toLowerCase()}`)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {pref.notify === l.id && <Check className="size-4" aria-hidden />}
            </span>
            <span className="min-w-0">
              <span className="block">{l.label}</span>
              <span className="block text-xs text-muted-foreground">{l.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void save(channel.id, { muted: !pref.muted }, pref.muted ? `Unmuted ${label}` : `Muted ${label}`)}
        >
          {pref.muted ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
          {pref.muted ? "Unmute conversation" : "Mute conversation"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChannelSearchButton({ label, onSearch }: { label: string; onSearch: () => void }) {
  return (
    <button type="button" onClick={onSearch} aria-label={`Search in ${label}`} className={cn(iconBtn, "hidden sm:flex")}>
      <Search className="size-4" aria-hidden />
    </button>
  );
}

export function ChannelMoreMenu({
  channel,
  label,
  isDM,
  onDetails,
}: {
  channel: Channel;
  label: string;
  isDM: boolean;
  onDetails: (tab: DetailsTab) => void;
}) {
  const pref = usePref(channel.id);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/w/${channel.workspace_id}/c/${channel.id}`);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`More actions for ${label}`} className={cn(iconBtn, "border-transparent")}>
        <MoreVertical className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => onDetails("about")}>
          <Settings className="size-4" aria-hidden />
          {isDM ? "Conversation details" : "Channel details"}
        </DropdownMenuItem>
        {!isDM && (
          <>
            <DropdownMenuItem onClick={() => onDetails("members")}>
              <Users className="size-4" aria-hidden />
              Members
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDetails("integrations")}>
              <Puzzle className="size-4" aria-hidden />
              Integrations
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => void save(channel.id, { starred: !pref.starred }, pref.starred ? `Removed ${label} from Starred` : `Starred ${label}`)}
        >
          <Star className="size-4" aria-hidden />
          {pref.starred ? "Remove from Starred" : "Star"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyLink()}>
          <Link2 className="size-4" aria-hidden />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
