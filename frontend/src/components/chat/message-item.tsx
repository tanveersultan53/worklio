"use client";

import {
  AlarmClock,
  Bookmark,
  BookmarkCheck,
  ChevronRight,
  Copy,
  FileText,
  Link as LinkIcon,
  MessageSquareText,
  MoreVertical,
  Pencil,
  SmilePlus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AIBadge, BotAvatar, CallAISummaryCard, isCallAISummaryMeta, useIsBotUser } from "@/components/ai/composer-assistant";
import { AgentAnswer, isAgentMessage } from "@/components/ai/agent-message";
import { AgentNotice, isAgentNotice, isHiddenEphemeral } from "@/components/ai/agent-notice";
import { MessageTranslation } from "@/components/ai/message-translation";
import { useAppearance } from "@/components/appearance-provider";
import { CallSystemMessage, isCallSystemMessage } from "@/components/calls";
import { MeetingSystemMessage } from "@/components/meetings/meeting-card";
import { DateTimeDialog } from "@/components/messaging/datetime-dialog";
import { ForwardDialog } from "@/components/messaging/forward-dialog";
import { MessageActionItems, useMessageActions } from "@/components/messaging/message-actions";
import { EditedLabel, ForwardedCard, PinnedLabel, UnfurlCards } from "@/components/messaging/message-extras";
import { PollCard } from "@/components/messaging/poll";
import { useGroupsById } from "@/components/messaging/use-groups";
import { StatusEmoji } from "@/components/profile/status-emoji";
import { isAudioAttachment, isVideoAttachment } from "@/components/voice/media";
import { VideoClipAttachment } from "@/components/voice/video-clip-player";
import { VoiceAttachment } from "@/components/voice/voice-player";
import { useWorkspace } from "@/components/workspace/provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api, type Attachment, type Message } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { QUICK_REACTIONS } from "@/lib/emoji";
import { decodeMentions, encodeMentions, formatMessage, isJumboEmoji, mentionsUser } from "@/lib/format";
import { dayLabel, formatBytes, media, messagePath, timeLabel } from "@/lib/messages";
import { rich } from "@/lib/messaging";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./confirm-dialog";
import { EmojiPicker } from "./emoji-picker";
import { ProfilePopover } from "./profile-popover";
import { UserAvatar } from "./user-avatar";

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Taps on these never toggle the touch toolbar: they do their own thing. */
const INTERACTIVE = "a,button,input,textarea,[role=button],[role=menuitem],[data-slot=popover-trigger]";
/** Portalled UI opened from a message; tapping inside it must not deselect the message. */
const OVERLAY = "[data-slot=popover-content],[data-slot=dropdown-menu-content],[data-slot=dialog-content]";

type MessageItemProps = {
  message: Message;
  compact: boolean; // same author as previous message within a few minutes
  onOpenThread?: (m: Message) => void;
  highlight?: boolean;
  /** Parent asks this message to enter edit mode (↑ in an empty composer). */
  editRequested?: boolean;
  /** Called when an edit (requested or not) is saved or cancelled. */
  onEditDone?: () => void;
};

/** Skips ephemeral-style system notices meant for someone else (e.g. the agent's "not added here" hint). */
export function MessageItem(props: MessageItemProps) {
  const { me } = useWorkspace();
  if (isHiddenEphemeral(props.message, me?.id)) return null;
  return <MessageRow {...props} />;
}

function MessageRow({
  message: m,
  compact,
  onOpenThread,
  highlight,
  editRequested,
  onEditDone,
}: MessageItemProps) {
  const { me, memberById, workspaceId, channels } = useWorkspace();
  const groups = useGroupsById(workspaceId);
  const actions = useMessageActions(m);
  const extra = rich(m);
  const channel = channels.find((c) => c.id === m.channel_id);
  const dense = useAppearance().prefs.density === "compact";
  const [editingSelf, setEditingSelf] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Touch devices have no hover: a tap on the message selects it and reveals the toolbar.
  const [active, setActive] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const author = memberById[m.author_id]?.full_name ?? "Unknown";
  // Messages from the Worklio bot (or any app/bot user) get an "AI" badge and a gradient avatar ring.
  const isBot = useIsBotUser()(m.author_id);
  // Server-authored messages (call cards, call notes): never editable or deletable, never "mention" anyone.
  const system = m.kind === "system";
  const callCard = system && isCallSystemMessage(m);
  const meetingCard = system && m.meta?.type === "meeting";
  const aiCallSummary = system && isCallAISummaryMeta(m.meta);
  const agentNotice = isAgentNotice(m);
  const mine = m.author_id === me?.id;
  const canModify = mine && !system;
  const mentionsMe = !mine && !system && mentionsUser(m.body, me?.id, groups);
  const pinned = actions.pinned;
  const saved = actions.saved;
  const editing = !system && (editingSelf || (!!editRequested && mine));

  // Deselect when the user taps anywhere else.
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || row.current?.contains(t) || t.closest?.(OVERLAY)) return;
      setActive(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [active]);

  const react = (emoji: string) => {
    setPickerOpen(false);
    api(`/messages/${m.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }).catch((err) =>
      toast.error(`Couldn't add reaction: ${errorMessage(err)}`),
    );
  };
  const startEdit = () => {
    setActive(false);
    setEditingSelf(true);
  };
  const finishEdit = () => {
    setEditingSelf(false);
    onEditDone?.();
  };
  const remove = () => api<void>(`/messages/${m.id}`, { method: "DELETE" });
  const copy = (text: string, done: string) => {
    copyText(text)
      .then(() => toast.success(done))
      .catch((err) => toast.error(errorMessage(err, "Couldn't copy to clipboard")));
  };

  const toolbarVisible = pickerOpen || menuOpen || active;

  return (
    <div
      ref={row}
      id={`msg-${m.id}`}
      data-message-id={m.id}
      onClick={(e) => {
        if (editing || !media.noHover()) return;
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        setActive((a) => !a);
      }}
      className={cn(
        "group relative flex gap-2.5 px-5 transition-colors duration-700",
        dense ? "py-px" : compact ? "py-0.5" : "pt-2 pb-1",
        editing
          ? "bg-highlight"
          : active
            ? "bg-muted/60"
            : pinned || saved
              ? "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-400/[0.06] dark:hover:bg-amber-400/10"
              : "hover:bg-muted/60",
        (mentionsMe || highlight) &&
          !editing &&
          "bg-highlight hover:bg-highlight before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-amber-400",
      )}
    >
      <div className={cn("shrink-0", dense ? "w-16" : "w-8")}>
        {dense ? (
          <span
            title={fullDate(m.created_at)}
            className={cn(
              "block text-right text-[11px] leading-(--msg-leading) text-muted-foreground",
              compact && !active && "invisible group-hover:visible",
            )}
          >
            {timeLabel(m.created_at)}
          </span>
        ) : compact ? (
          <span
            title={fullDate(m.created_at)}
            className={cn(
              "block pt-1 text-right text-[11px] leading-(--msg-leading) text-muted-foreground",
              !active && "invisible group-hover:visible",
            )}
          >
            {timeLabel(m.created_at).replace(/\s?[AP]M$/i, "")}
          </span>
        ) : (
          <ProfilePopover userId={m.author_id}>
            {isBot ? (
              <BotAvatar id={m.author_id} name={author} className="mt-1" />
            ) : (
              <UserAvatar id={m.author_id} name={author} className="mt-1" />
            )}
          </ProfilePopover>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {(pinned || saved) && (
          <div className="flex flex-wrap items-center gap-x-3">
            {pinned && <PinnedLabel pinnedBy={extra.pinned_by} />}
            {saved && (
              <div className="mb-0.5 flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <BookmarkCheck className="size-3" /> Saved for later
              </div>
            )}
          </div>
        )}
        {!compact && !dense && (
          <div className="flex items-baseline gap-2">
            <span className="flex min-w-0 items-baseline gap-1">
              <ProfilePopover userId={m.author_id} className="min-w-0">
                <span className="text-msg font-black [overflow-wrap:anywhere] hover:underline">{author}</span>
              </ProfilePopover>
              {isBot ? (
                <AIBadge className="self-center" />
              ) : (
                <StatusEmoji userId={m.author_id} className="self-center text-[13px]" />
              )}
            </span>
            <span title={fullDate(m.created_at)} className="text-xs text-muted-foreground hover:underline">
              {timeLabel(m.created_at)}
            </span>
          </div>
        )}

        {callCard ? (
          <>
            {dense && !compact && (
              <div className="text-msg">
                <DenseName userId={m.author_id} name={author} isBot={isBot} />
              </div>
            )}
            <CallSystemMessage message={m} />
          </>
        ) : meetingCard ? (
          <>
            {dense && !compact && (
              <div className="text-msg">
                <DenseName userId={m.author_id} name={author} isBot={isBot} />
              </div>
            )}
            <MeetingSystemMessage message={m} />
          </>
        ) : aiCallSummary ? (
          <>
            {dense && !compact && (
              <div className="text-msg">
                <DenseName userId={m.author_id} name={author} isBot={isBot} />
              </div>
            )}
            <CallAISummaryCard message={m} />
          </>
        ) : editing ? (
          <MessageEditor message={m} onDone={finishEdit} />
        ) : agentNotice ? (
          <>
            {dense && !compact && (
              <div className="text-msg">
                <DenseName userId={m.author_id} name={author} isBot={isBot} />
              </div>
            )}
            <AgentNotice message={m} />
          </>
        ) : system && m.meta?.type === "reminder" ? (
          <div className="mt-0.5 flex max-w-md items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <AlarmClock className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">Reminder</p>
              <p className="text-msg break-words whitespace-pre-wrap">
                {typeof m.meta.text === "string" ? m.meta.text : m.body.replace(/^⏰\s*Reminder:\s*/, "")}
              </p>
            </div>
          </div>
        ) : system ? (
          m.body && <div className="text-msg break-words whitespace-pre-wrap text-muted-foreground italic">{m.body}</div>
        ) : (
          // A poll's body is its question, which the poll card already shows.
          m.body && !extra.poll && (
            <div
              className={cn(
                "break-words whitespace-pre-wrap",
                isJumboEmoji(m.body) && !dense ? "text-4xl leading-[1.3]" : "text-msg",
              )}
            >
              {dense && !compact && <DenseName userId={m.author_id} name={author} isBot={isBot} />}
              {isBot && isAgentMessage(m) ? (
                <AgentAnswer message={m} />
              ) : (
                formatMessage(m.body, { names: memberById, meId: me?.id, groups })
              )}
              {m.edited_at && <EditedLabel messageId={m.id} editedAt={m.edited_at} editCount={extra.edit_count} />}
            </div>
          )
        )}
        {!editing && !system && <MessageTranslation messageId={m.id} />}

        {dense && !compact && (!m.body || !!extra.poll) && !editing && !callCard && !aiCallSummary && !agentNotice && (
          <div className="text-msg">
            <DenseName userId={m.author_id} name={author} isBot={isBot} />
          </div>
        )}
        {!editing && extra.forwarded_from && <ForwardedCard from={extra.forwarded_from} />}
        {!editing && extra.poll && <PollCard poll={extra.poll} authorId={m.author_id} />}
        {m.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {m.attachments.map((a) => (
              <AttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}

        {!editing && !!extra.unfurls?.length && (
          <UnfurlCards messageId={m.id} unfurls={extra.unfurls} canHide={canModify} />
        )}

        {m.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {m.reactions.map((r) => {
              const reacted = !!me && r.user_ids.includes(me.id);
              const names = r.user_ids.map((id) => (id === me?.id ? "You" : (memberById[id]?.full_name ?? "Someone")));
              return (
                <button
                  key={r.emoji}
                  onClick={() => react(r.emoji)}
                  title={`${names.join(", ")} reacted with ${r.emoji}`}
                  aria-pressed={reacted}
                  className={cn(
                    "flex h-7 items-center gap-1 rounded-full border px-2 text-xs sm:h-6",
                    reacted
                      ? "border-pill-mine-border bg-pill-mine text-link"
                      : "border-transparent bg-pill hover:border-muted-foreground/40",
                  )}
                >
                  <span className="text-sm">{r.emoji}</span>
                  <span className="font-bold">{r.user_ids.length}</span>
                </button>
              );
            })}
            <Popover>
              <PopoverTrigger
                className="flex h-7 items-center rounded-full bg-pill px-2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-popup-open:opacity-100 sm:h-6 [@media(hover:none)]:opacity-100"
                aria-label="Add reaction"
              >
                <SmilePlus className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <EmojiPicker onPick={react} />
              </PopoverContent>
            </Popover>
          </div>
        )}

        {onOpenThread && m.reply_count > 0 && (
          <button
            onClick={() => onOpenThread(m)}
            className="group/thread -ml-1 mt-1 flex w-full max-w-xl items-center gap-2 rounded-md border border-transparent p-1 text-left text-[13px] hover:border-border hover:bg-background"
          >
            <span className="flex">
              {m.reply_user_ids.slice(0, 3).map((id) => (
                <UserAvatar key={id} id={id} name={memberById[id]?.full_name ?? "?"} size="sm" className="mr-1" />
              ))}
            </span>
            <span className="font-bold text-link hover:underline">
              {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
            </span>
            {m.last_reply_at && (
              <span className="truncate text-muted-foreground group-hover/thread:hidden">
                Last reply {dayLabel(m.last_reply_at).toLowerCase()} at {timeLabel(m.last_reply_at)}
              </span>
            )}
            <span className="hidden text-muted-foreground group-hover/thread:inline">View thread</span>
            <ChevronRight className="ml-auto hidden size-4 text-muted-foreground group-hover/thread:block" />
          </button>
        )}
      </div>

      {!editing && (
        <div
          className={cn(
            "absolute -top-4 right-3 z-10 items-center rounded-lg border bg-background p-0.5 shadow-sm sm:right-5",
            toolbarVisible ? "flex" : "hidden group-hover:flex group-has-[:focus-visible]:flex",
          )}
        >
          {QUICK_REACTIONS.map((e) => (
            <ToolbarButton
              key={e}
              label={`React with ${e}`}
              onClick={() => {
                setActive(false);
                react(e);
              }}
            >
              <span className="text-base leading-none">{e}</span>
            </ToolbarButton>
          ))}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8"
              aria-label="Add reaction"
              title="Add reaction"
            >
              <SmilePlus className="size-[18px]" />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <EmojiPicker
                onPick={(e) => {
                  setActive(false);
                  react(e);
                }}
              />
            </PopoverContent>
          </Popover>
          {onOpenThread && (
            <ToolbarButton
              label="Reply in thread"
              onClick={() => {
                setActive(false);
                onOpenThread(m);
              }}
            >
              <MessageSquareText className="size-[18px]" />
            </ToolbarButton>
          )}
          {!system && (
            <ToolbarButton
              label={saved ? "Remove from Later" : "Save for later"}
              onClick={() => {
                setActive(false);
                actions.toggleSave();
              }}
            >
              {saved ? (
                <BookmarkCheck className="size-[18px] text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Bookmark className="size-[18px]" />
              )}
            </ToolbarButton>
          )}
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(o) => {
              setMenuOpen(o);
              if (o) actions.refreshFollow();
            }}
          >
            <DropdownMenuTrigger
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8"
              aria-label="More actions"
              title="More actions"
            >
              <MoreVertical className="size-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <MessageActionItems
                actions={actions}
                message={m}
                canPin={!channel?.is_archived}
                onDone={() => setActive(false)}
              />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setActive(false);
                  copy(`${window.location.origin}${messagePath(m)}`, "Link copied");
                }}
              >
                <LinkIcon className="size-4" /> Copy link
              </DropdownMenuItem>
              {m.body && (
                <DropdownMenuItem
                  onClick={() => {
                    setActive(false);
                    copy(system ? m.body : decodeMentions(m.body, memberById, groups), "Text copied");
                  }}
                >
                  <Copy className="size-4" /> Copy text
                </DropdownMenuItem>
              )}
              {canModify && (
                <>
                  <DropdownMenuSeparator />
                  {m.body && (
                    <DropdownMenuItem onClick={startEdit}>
                      <Pencil className="size-4" /> Edit message
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setActive(false);
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash2 className="size-4" /> Delete message
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {actions.forwardOpen && <ForwardDialog message={m} open onOpenChange={actions.setForwardOpen} />}
      {actions.remindOpen && (
        <DateTimeDialog
          open
          onOpenChange={actions.setRemindOpen}
          title="Remind me about this"
          description="We'll send you a reminder in your direct messages."
          confirmLabel="Set reminder"
          onPick={actions.remind}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          onOpenChange={setConfirmDelete}
          title="Delete message"
          description="Are you sure you want to delete this message? This can't be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={remove}
        >
          <div className="flex gap-2">
            <UserAvatar id={m.author_id} name={author} size="sm" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-black">{author}</span>
                <span className="text-xs text-muted-foreground">{timeLabel(m.created_at)}</span>
              </div>
              {m.body ? (
                <div className="line-clamp-6">{formatMessage(m.body, { names: memberById, meId: me?.id, groups })}</div>
              ) : (
                <em className="text-muted-foreground">
                  {m.attachments.length} {m.attachments.length === 1 ? "file" : "files"}
                </em>
              )}
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** In-place editor. Owns its draft so edit mode can be entered from outside (↑ shortcut). */
function MessageEditor({ message: m, onDone }: { message: Message; onDone: () => void }) {
  const { memberById, members, workspaceId } = useWorkspace();
  const groupsById = useGroupsById(workspaceId);
  const [draft, setDraft] = useState(() => decodeMentions(m.body, memberById, groupsById));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // Bring the editor into view when it opens off-screen (↑ on a long-ago message).
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const save = async () => {
    if (saving) return;
    const body = encodeMentions(draft.trim(), members, Object.values(groupsById));
    if (!body || body === m.body) {
      onDone();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ body }) });
      onDone();
    } catch (err) {
      setError(`Couldn't save your changes: ${errorMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={box} className="space-y-2 py-1">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        className="bg-background text-[length:max(16px,var(--msg-size,15px))]! sm:text-msg!"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            // Don't let the surrounding thread panel treat this as "close".
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" className="bg-send text-white hover:bg-send/90" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground sm:size-8"
    >
      {children}
    </button>
  );
}

export function AttachmentView({ attachment: a }: { attachment: Attachment }) {
  if (isAudioAttachment(a)) return <VoiceAttachment attachment={a} />;
  if (isVideoAttachment(a)) return <VideoClipAttachment attachment={a} />;
  if (a.content_type.startsWith("image/")) {
    return (
      <a href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
        {/* eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL, not optimisable */}
        <img src={a.url} alt={a.filename} className="max-h-80 max-w-full object-contain sm:max-w-md" />
      </a>
    );
  }
  const ext = a.filename.split(".").pop()?.toUpperCase().slice(0, 4) ?? "FILE";
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer"
      className="flex w-72 max-w-full items-center gap-3 rounded-lg border bg-background p-2.5 hover:bg-muted/60"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-sky-600 text-white">
        <FileText className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{a.filename}</span>
        <span className="block text-xs text-muted-foreground">
          {ext} · {formatBytes(a.size)}
        </span>
      </span>
    </a>
  );
}

function DenseName({ userId, name, isBot }: { userId: string; name: string; isBot?: boolean }) {
  return (
    <span className="mr-1.5">
      <ProfilePopover userId={userId}>
        <span className="font-black hover:underline">{name}</span>
      </ProfilePopover>
      {isBot ? (
        <AIBadge className="ml-1 align-[0.05em]" />
      ) : (
        <StatusEmoji userId={userId} className="ml-1 align-[-0.1em] text-[0.85em]" />
      )}
    </span>
  );
}
