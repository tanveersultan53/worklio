"use client";

import { Hash, Lock, MessageCircle, Paperclip } from "lucide-react";
import Link from "next/link";

import { StatusEmoji } from "@/components/profile/status-emoji";
import { UserAvatar } from "@/components/chat/user-avatar";
import { useWorkspace } from "@/components/workspace/provider";
import type { Channel, Message } from "@/lib/api";
import { markdownToMessage } from "@/lib/ai";
import { formatMessage } from "@/lib/format";
import { dayLabel, timeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";

/** Channel glyph for a conversation kind. */
export function ChannelIcon({ channel, className }: { channel: Channel | undefined; className?: string }) {
  if (channel?.kind === "dm") return <MessageCircle className={cn("size-3.5", className)} aria-hidden />;
  if (channel?.kind === "private") return <Lock className={cn("size-3.5", className)} aria-hidden />;
  return <Hash className={cn("size-3.5", className)} aria-hidden />;
}

/** "#design" / "Alice, Bob" with its icon; links to the channel when `link` is set. */
export function ChannelTag({
  channelId,
  fallback,
  link,
  className,
}: {
  channelId: string | null | undefined;
  fallback?: string;
  link?: boolean;
  className?: string;
}) {
  const ws = useWorkspace();
  const channel = channelId ? ws.channels.find((c) => c.id === channelId) : undefined;
  const label = channel ? ws.channelLabel(channel) : (fallback ?? "a conversation");
  const inner = (
    <>
      <ChannelIcon channel={channel} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  const cls = cn("inline-flex min-w-0 items-center gap-1 font-bold", className);
  if (link && channelId)
    return (
      <Link href={`/w/${ws.workspaceId}/c/${channelId}`} className={cn(cls, "hover:underline")} onClick={(e) => e.stopPropagation()}>
        {inner}
      </Link>
    );
  return <span className={cls}>{inner}</span>;
}

/** Plain-ish message preview: avatar, author, time and formatted (clamped) body. */
export function MessageSnippet({
  message: m,
  clamp = 3,
  showAvatar = true,
  className,
}: {
  message: Message;
  clamp?: 2 | 3 | 4 | 6;
  showAvatar?: boolean;
  className?: string;
}) {
  const ws = useWorkspace();
  const author = ws.memberById[m.author_id]?.full_name ?? (m.author_id === ws.me?.id ? ws.me?.full_name : null) ?? "Unknown";
  const deleted = !!m.deleted_at;
  const clampCls = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" }[clamp];
  return (
    <div className={cn("flex min-w-0 gap-2.5", className)}>
      {showAvatar && <UserAvatar id={m.author_id} name={author} className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="truncate text-msg font-black">{author}</span>
            <StatusEmoji userId={m.author_id} className="self-center text-[13px]" />
          </span>
          <time dateTime={m.created_at} className="shrink-0 text-xs text-muted-foreground">
            {dayLabel(m.created_at)} at {timeLabel(m.created_at)}
          </time>
        </div>
        <div className={cn("text-msg break-words whitespace-pre-wrap", clampCls)}>
          {deleted ? (
            <em className="text-muted-foreground">This message was deleted.</em>
          ) : m.body ? (
            // AI answers are Markdown with [n] citations; previews show them as plain message text.
            formatMessage(m.meta?.type === "ai_agent" ? markdownToMessage(m.body) : m.body, { names: ws.memberById, meId: ws.me?.id })
          ) : m.attachments.length ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Paperclip className="size-3.5" />
              {m.attachments.length === 1 ? m.attachments[0].filename : `${m.attachments.length} files`}
            </span>
          ) : (
            <em className="text-muted-foreground">No text</em>
          )}
        </div>
      </div>
    </div>
  );
}

const GROUP_WINDOW_MS = 5 * 60_000;

/** Whether `m` continues `prev` (same author, same day, within 5 min, neither a system message). */
export function continues(prev: Message | undefined, m: Message): boolean {
  if (!prev || m.kind === "system" || prev.kind === "system" || prev.author_id !== m.author_id) return false;
  if (dayLabel(prev.created_at) !== dayLabel(m.created_at)) return false;
  return new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
}

/** Link that opens a message's thread in its channel. */
export function threadPath(m: Pick<Message, "id" | "workspace_id" | "channel_id">): string {
  return `/w/${m.workspace_id}/c/${m.channel_id}?${new URLSearchParams({ msg: m.id, thread: m.id })}`;
}
