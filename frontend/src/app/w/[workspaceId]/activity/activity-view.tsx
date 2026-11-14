"use client";

import {
  AlarmClock,
  AtSign,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  Hash,
  Headphones,
  KanbanSquare,
  MessagesSquare,
  PhoneMissed,
  SmilePlus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { useNow } from "@/components/profile/profile-utils";
import { UserAvatar } from "@/components/chat/user-avatar";
import { InviteRsvp } from "@/components/meetings/invite-rsvp";
import { ChannelTag, MessageSnippet } from "@/components/views/message-snippet";
import { usePaged } from "@/components/views/use-paged";
import { SELECTED_ROW, useListNav } from "@/components/views/use-list-nav";
import {
  Chip,
  EmptyState,
  ErrorBlock,
  KeyHint,
  LoadMore,
  LoadingList,
  ViewHeader,
  ViewPage,
  ViewTabs,
} from "@/components/views/view-shell";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { formatMessage } from "@/lib/format";
import { dayLabel, messagePath } from "@/lib/messages";
import {
  activityMatches,
  asProductivityEvent,
  productivity,
  shortAgo,
  type ActivityFilter,
  type ActivityItem,
  type ActivityPage,
  type ActivityType,
} from "@/lib/productivity";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const TABS: { key: ActivityFilter; label: string; icon: LucideIcon }[] = [
  { key: "all", label: "All", icon: Bell },
  { key: "mentions", label: "Mentions", icon: AtSign },
  { key: "reactions", label: "Reactions", icon: SmilePlus },
  { key: "threads", label: "Threads", icon: MessagesSquare },
  { key: "invites", label: "Invites", icon: UserPlus },
];

const TYPE_META: Record<ActivityType, { icon: LucideIcon; tint: string }> = {
  mention: { icon: AtSign, tint: "bg-sky-600" },
  reaction: { icon: SmilePlus, tint: "bg-amber-500" },
  thread_reply: { icon: MessagesSquare, tint: "bg-violet-600" },
  channel_invite: { icon: UserPlus, tint: "bg-emerald-600" },
  call_missed: { icon: PhoneMissed, tint: "bg-rose-600" },
  reminder: { icon: AlarmClock, tint: "bg-orange-500" },
  huddle_started: { icon: Headphones, tint: "bg-teal-600" },
  card_mention: { icon: KanbanSquare, tint: "bg-indigo-600" },
  meeting_invite: { icon: CalendarDays, tint: "bg-pink-600" },
  meeting_reminder: { icon: CalendarClock, tint: "bg-pink-600" },
};

const EMPTY_COPY: Record<ActivityFilter, string> = {
  all: "Mentions, reactions to your messages, thread replies and invites will show up here.",
  mentions: "When someone @mentions you, or @here / @channel, it will show up here.",
  reactions: "When someone reacts to one of your messages, it will show up here.",
  threads: "Replies to threads you follow will show up here.",
  invites: "When someone adds you to a channel, it will show up here.",
};

/** Activity v2: everything that needs your attention, with tabs and read state. */
export function ActivityView() {
  const ws = useWorkspace();
  const router = useRouter();
  const now = useNow();
  const [tab, setTab] = useState<ActivityFilter>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const paged = usePaged<ActivityItem, ActivityPage>(
    `${ws.workspaceId}:${tab}:${unreadOnly}`,
    (cursor) => productivity.activity(ws.workspaceId, { type: tab, unreadOnly, cursor }),
    (a) => a.id,
  );
  const { items, setItems, setFirst } = paged;
  const unreadCount = paged.first?.unread_count ?? 0;

  const markRead = (ids: string[]) => {
    const targets = (items ?? []).filter((a) => ids.includes(a.id) && !a.read);
    if (!targets.length) return;
    const set = new Set(targets.map((a) => a.id));
    setItems((list) => list.map((a) => (set.has(a.id) ? { ...a, read: true } : a)));
    setFirst((f) => ({ ...f, unread_count: Math.max(0, f.unread_count - targets.length) }));
    productivity.markActivityRead(ws.workspaceId, { ids: [...set] }).catch(() => {
      setItems((list) => list.map((a) => (set.has(a.id) ? { ...a, read: false } : a)));
      setFirst((f) => ({ ...f, unread_count: f.unread_count + targets.length }));
    });
  };

  const markAllRead = () => {
    const before = items ?? [];
    const count = unreadCount;
    setItems((list) => list.map((a) => (a.read ? a : { ...a, read: true })));
    setFirst((f) => ({ ...f, unread_count: 0 }));
    productivity
      .markActivityRead(ws.workspaceId, { all: true })
      .then(() => toast.success("All caught up"))
      .catch((err) => {
        const unread = new Set(before.filter((a) => !a.read).map((a) => a.id));
        setItems((list) => list.map((a) => (unread.has(a.id) ? { ...a, read: false } : a)));
        setFirst((f) => ({ ...f, unread_count: count }));
        toast.error(`Couldn't mark everything as read: ${errorMessage(err)}`);
      });
  };

  const open = (a: ActivityItem) => {
    markRead([a.id]);
    ws.setSidebarOpen(false);
    const cardId = a.type === "card_mention" && typeof a.meta?.card_id === "string" ? a.meta.card_id : null;
    if (cardId && a.channel_id)
      router.push(`/w/${ws.workspaceId}/c/${a.channel_id}?tab=board&card=${encodeURIComponent(cardId)}`);
    else if (a.message) router.push(messagePath(a.message), { scroll: false });
    else if (a.channel_id) router.push(`/w/${ws.workspaceId}/c/${a.channel_id}`);
  };

  const nav = useListNav({
    scope: "activity",
    count: items?.length ?? 0,
    onOpen: (i) => items?.[i] && open(items[i]),
  });

  useWorkspaceEvents((e) => {
    const p = asProductivityEvent(e);
    if (p?.type === "activity.new") {
      if (!activityMatches(tab, p.item.type)) return;
      setItems((list) => (list.some((a) => a.id === p.item.id) ? list : [p.item, ...list]));
      if (!p.item.read) setFirst((f) => ({ ...f, unread_count: f.unread_count + 1 }));
      return;
    }
    if (e.type === "resync") return paged.reload(true);
    if (e.type === "message.updated") {
      setItems((list) =>
        list.some((a) => a.message?.id === e.message.id)
          ? list.map((a) => (a.message?.id === e.message.id ? { ...a, message: { ...a.message, ...e.message } } : a))
          : list,
      );
    } else if (e.type === "message.deleted") {
      setItems((list) =>
        list.some((a) => a.message?.id === e.message_id)
          ? list.map((a) =>
              a.message?.id === e.message_id ? { ...a, message: { ...a.message, deleted_at: new Date().toISOString(), body: "" } } : a,
            )
          : list,
      );
    }
  });

  return (
    <ViewPage label="Activity">
      <ViewHeader
        icon={Bell}
        title="Activity"
        subtitle={unreadCount ? `${unreadCount} unread` : undefined}
        actions={
          <>
            <Chip active={unreadOnly} onClick={() => setUnreadOnly((u) => !u)}>
              Unread only
            </Chip>
            <button
              onClick={markAllRead}
              disabled={!unreadCount}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <CheckCheck className="size-4" />
              <span className="hidden sm:inline">Mark all read</span>
            </button>
          </>
        }
      >
        <ViewTabs
          label="Activity type"
          tabs={TABS.map((t) => ({ ...t, count: t.key === tab ? unreadCount : undefined }))}
          value={tab}
          onChange={setTab}
          trailing={<KeyHint />}
        />
      </ViewHeader>

      <div className="flex-1 overflow-y-auto">
        {paged.error && <ErrorBlock message={paged.error} onRetry={() => paged.reload()} />}
        {!items && !paged.error && <LoadingList />}
        {items?.length === 0 && (
          <EmptyState icon={TABS.find((t) => t.key === tab)!.icon} title={unreadOnly ? "Nothing unread" : "You're all caught up"}>
            {EMPTY_COPY[tab]}
          </EmptyState>
        )}
        {items && items.length > 0 && (
          <ul role="list" className="pb-2">
            {items.map((a, i) => {
              const day = dayLabel(a.created_at);
              const newDay = i === 0 || dayLabel(items[i - 1].created_at) !== day;
              return (
                <Fragment key={a.id}>
                  {newDay && (
                    <li
                      aria-hidden
                      className="sticky top-0 z-10 border-b bg-background/95 px-4 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur sm:px-5"
                    >
                      {day}
                    </li>
                  )}
                  <li>
                    <ActivityRow
                      item={a}
                      now={now}
                      navProps={nav.rowProps(i)}
                      onOpen={() => {
                        nav.setIndex(i);
                        open(a);
                      }}
                      onMarkRead={() => markRead([a.id])}
                    />
                  </li>
                </Fragment>
              );
            })}
            <li>
              <LoadMore hasMore={paged.hasMore} loading={paged.loadingMore} error={paged.moreError} onMore={paged.loadMore} />
            </li>
          </ul>
        )}
      </div>
    </ViewPage>
  );
}

function ActivityRow({
  item: a,
  now,
  navProps,
  onOpen,
  onMarkRead,
}: {
  item: ActivityItem;
  now: number;
  navProps: Record<string, unknown>;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const ws = useWorkspace();
  const actor = a.actor_id ? (ws.memberById[a.actor_id]?.full_name ?? "Someone") : null;
  const meta = TYPE_META[a.type] ?? TYPE_META.mention;
  const Icon = meta.icon;
  const where = a.channel_id ? <ChannelTag channelId={a.channel_id} className="text-foreground" /> : null;

  const headline = (() => {
    const who = <span className="font-black text-foreground">{actor ?? "Someone"}</span>;
    switch (a.type) {
      case "mention":
        return <>{who} mentioned you{where && <> in {where}</>}</>;
      case "reaction":
        return (
          <>
            {who} reacted {a.emoji && <span className="text-base leading-none">{a.emoji}</span>} to your message
            {where && <> in {where}</>}
          </>
        );
      case "thread_reply":
        return <>{who} replied to a thread{where && <> in {where}</>}</>;
      case "channel_invite":
        return <>{who} added you to {where ?? "a channel"}</>;
      case "call_missed":
        return <>Missed call from {who}{where && <> in {where}</>}</>;
      case "reminder":
        return <span className="font-black text-foreground">Reminder</span>;
      case "huddle_started":
        return <>{who} started a {a.meta?.kind === "video" ? "video huddle" : "huddle"}{where && <> in {where}</>}</>;
      case "card_mention": {
        const title = typeof a.meta?.card_title === "string" && a.meta.card_title ? a.meta.card_title : "a card";
        return (
          <>
            {who} mentioned you on <span className="font-bold text-foreground">{title}</span>
            {where && <> in {where}</>}
          </>
        );
      }
      case "meeting_invite":
      case "meeting_reminder": {
        const title = typeof a.meta?.title === "string" && a.meta.title ? a.meta.title : "a meeting";
        const at = typeof a.meta?.starts_at === "string" ? new Date(a.meta.starts_at) : null;
        const when = at
          ? `${at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
          : "";
        return a.type === "meeting_invite" ? (
          <>
            {who} invited you to <span className="font-bold text-foreground">{title}</span>
            {when && <> · {when}</>}
          </>
        ) : (
          <>
            <span className="font-bold text-foreground">{title}</span> starts in 10 minutes{where && <> in {where}</>}
          </>
        );
      }
      default:
        return <>{who}</>;
    }
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      {...navProps}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer gap-3 border-b px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted/70 sm:px-5",
        SELECTED_ROW,
        !a.read && "bg-mention/40",
      )}
    >
      <span className="relative mt-0.5 shrink-0">
        {a.actor_id ? (
          <UserAvatar id={a.actor_id} name={actor ?? "?"} />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-md bg-muted">
            {a.type === "channel_invite" ? <Hash className="size-4" /> : <Icon className="size-4" />}
          </span>
        )}
        <span
          className={cn(
            "absolute -right-1.5 -bottom-1.5 flex size-[18px] items-center justify-center rounded-full text-white ring-2 ring-background",
            meta.tint,
          )}
          aria-hidden
        >
          <Icon className="size-2.5" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{headline}</p>
          <time dateTime={a.created_at} className="shrink-0 text-xs text-muted-foreground" title={new Date(a.created_at).toLocaleString()}>
            {shortAgo(a.created_at, now)}
          </time>
          {!a.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-tab" aria-label="Unread" />}
        </div>
        {a.type === "meeting_invite" && typeof a.meta?.meeting_id === "string" && <InviteRsvp meetingId={a.meta.meeting_id} />}
        {a.type === "card_mention" && typeof a.meta?.excerpt === "string" && a.meta.excerpt && (
          <div className="mt-1.5 line-clamp-3 rounded-lg border bg-background/70 p-2.5 text-sm break-words whitespace-pre-wrap">
            {formatMessage(a.meta.excerpt, { names: ws.memberById, meId: ws.me?.id })}
          </div>
        )}
        {a.message && (
          <div className="mt-1.5 rounded-lg border bg-background/70 p-2.5">
            <MessageSnippet message={a.message} clamp={3} showAvatar={a.type === "reaction"} />
          </div>
        )}
      </div>
      {!a.read && (
        <button
          onClick={onMarkRead}
          className="absolute top-2 right-12 hidden h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs font-semibold shadow-xs group-hover:flex hover:bg-muted"
          title="Mark as read"
        >
          <CheckCheck className="size-3.5" /> Mark read
        </button>
      )}
    </div>
  );
}
