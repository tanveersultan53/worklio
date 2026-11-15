"use client";

import { ArrowDown } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { isFinishedCallMessage } from "@/components/calls";
import { ReadReceipt } from "@/components/messaging/read-receipts";
import { useWorkspace } from "@/components/workspace/provider";
import type { Message } from "@/lib/api";
import { editLast, sameScope } from "@/lib/edit-last";
import { dayLabel } from "@/lib/messages";
import { errorMessage, toast } from "@/lib/toast";

import { MessageItem } from "./message-item";

const GROUP_WINDOW_MS = 5 * 60_000;

export function MessageList({
  messages,
  onOpenThread,
  onLoadOlder,
  hasMore,
  hasNewer = false,
  onLoadNewer,
  onJumpToLatest,
  header,
  firstUnreadId,
  loading,
  highlightId,
}: {
  messages: Message[]; // oldest first
  onOpenThread?: (m: Message) => void;
  onLoadOlder?: () => Promise<void>;
  hasMore?: boolean;
  /** Newer history isn't loaded (after a jump): scrolling to the bottom loads it. */
  hasNewer?: boolean;
  onLoadNewer?: () => Promise<void>;
  /** Reload the latest messages (shown as "Jump to latest" while `hasNewer`). */
  onJumpToLatest?: () => Promise<void>;
  header?: React.ReactNode;
  firstUnreadId?: string | null;
  loading?: boolean;
  /** Scroll this message into view (centered) and highlight it, e.g. when jumping from search. */
  highlightId?: string | null;
}) {
  const { me, channels } = useWorkspace();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const loadFailedAt = useRef(0);
  const scrolledTo = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  const [atBottom, setAtBottom] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  });

  // Keep the view pinned to the bottom for new messages; keep position stable when older ones load.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Jump to a specific message (search hit, mention, shared link) once it is rendered.
  useLayoutEffect(() => {
    if (!highlightId) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === highlightId) return;
    const target = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(highlightId)}"]`);
    if (!target) return;
    scrolledTo.current = highlightId;
    stickToBottom.current = false;
    target.scrollIntoView({ block: "center" });
  }, [highlightId, messages]);

  // Late layout changes (images loading, composer growing) shouldn't unpin the view from the bottom.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current && prevHeight.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(inner);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ↑ in the sibling composer (same channel / thread) edits my most recent message.
  useEffect(
    () =>
      editLast.subscribe((e) => {
        const list = messagesRef.current;
        if (e.kind !== "request" || !list.length) return;
        if (!sameScope(e, { channelId: list[0].channel_id, parentId: list[0].parent_id })) return;
        const last = [...list].reverse().find((m) => m.author_id === me?.id && m.kind !== "system" && m.body && !m.deleted_at);
        if (last) setEditingId(last.id);
      }),
    [me?.id],
  );

  const endEdit = () => {
    setEditingId(null);
    const first = messagesRef.current[0];
    if (first) editLast.done(first.channel_id, first.parent_id);
  };

  const loadOlder = async () => {
    if (!onLoadOlder || !scroller.current || prevHeight.current !== null) return;
    prevHeight.current = scroller.current.scrollHeight;
    setLoadError(false);
    try {
      await onLoadOlder();
    } catch (err) {
      prevHeight.current = null;
      loadFailedAt.current = Date.now();
      setLoadError(true);
      toast.error(`Couldn't load older messages: ${errorMessage(err)}`);
    }
  };

  // DM read receipts go under my latest message in a DM timeline (not in threads).
  const first = messages[0];
  const isDMTimeline =
    !!first && first.parent_id === null && channels.find((c) => c.id === first.channel_id)?.kind === "dm";
  let lastMineId: string | null = null;
  if (isDMTimeline) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.kind === "system") continue;
      if (m.author_id === me?.id) lastMineId = m.id;
      break;
    }
  }

  const loadingNewer = useRef(false);
  const loadNewer = async () => {
    if (!onLoadNewer || loadingNewer.current) return;
    loadingNewer.current = true;
    try {
      await onLoadNewer();
    } catch (err) {
      toast.error(`Couldn't load newer messages: ${errorMessage(err)}`);
    } finally {
      loadingNewer.current = false;
    }
  };

  const jumpToBottom = () => {
    if (hasNewer && onJumpToLatest) {
      stickToBottom.current = true;
      onJumpToLatest().catch((err) => toast.error(`Couldn't load the latest messages: ${errorMessage(err)}`));
      return;
    }
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="flex-1 overflow-y-auto pb-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          // While newer history is unloaded, the bottom of the list isn't "now": don't stick to it.
          stickToBottom.current = bottom && !hasNewer;
          if (bottom !== atBottom) setAtBottom(bottom);
          if (hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 400) loadNewer();
          // After a failure, wait a moment before retrying automatically (the button retries at once).
          if (el.scrollTop < 40 && hasMore && prevHeight.current === null && Date.now() - loadFailedAt.current > 5000)
            loadOlder();
        }}
      >
        <div ref={content}>
          {loading ? (
            <Skeleton />
          ) : hasMore ? (
            loadError ? (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Couldn&apos;t load older messages.{" "}
                <button onClick={loadOlder} className="font-bold text-link hover:underline">
                  Try again
                </button>
              </div>
            ) : (
              <div className="py-4 text-center text-xs text-muted-foreground">Loading older messages…</div>
            )
          ) : (
            header
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
            const isFirstUnread = m.id === firstUnreadId;
            // A finished call is a one-line event: never gets its own name/avatar header.
            const compact =
              (isFinishedCallMessage(m) && !isFirstUnread) ||
              (!!prev &&
              !newDay &&
              !isFirstUnread &&
              // System messages (call cards, call notes) always stand on their own.
              m.kind !== "system" &&
              prev.kind !== "system" &&
              prev.author_id === m.author_id &&
              new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="sticky top-0 z-[5] flex items-center py-2">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    <span className="relative mx-auto rounded-full border bg-background px-4 py-1 text-[13px] font-bold shadow-xs">
                      {dayLabel(m.created_at)}
                    </span>
                  </div>
                )}
                {isFirstUnread && (
                  <div className="relative my-1 flex items-center px-5">
                    <div className="h-px flex-1 bg-rose-500" />
                    <span className="ml-2 text-xs font-bold text-rose-500">New</span>
                  </div>
                )}
                <MessageItem
                  message={m}
                  compact={compact}
                  onOpenThread={onOpenThread}
                  highlight={m.id === highlightId}
                  editRequested={m.id === editingId}
                  onEditDone={endEdit}
                />
                {m.id === lastMineId && <ReadReceipt message={m} />}
              </Fragment>
            );
          })}
        </div>
      </div>
      {(!atBottom || hasNewer) && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-link px-3 py-2 text-xs font-bold whitespace-nowrap text-white shadow-lg sm:py-1.5"
        >
          <ArrowDown className="size-3.5" /> {hasNewer ? "Jump to latest" : "Jump to recent messages"}
        </button>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-5 px-5 pt-6">
      {[60, 85, 40, 70].map((w, i) => (
        <div key={i} className="flex animate-pulse gap-2.5">
          <div className="size-8 shrink-0 rounded-md bg-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-3 rounded bg-muted" style={{ width: `${w}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
