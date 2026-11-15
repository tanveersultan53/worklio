"use client";

import Link from "next/link";
import {
  Archive,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  Hash,
  KanbanSquare,
  Lock,
  MessageSquare,
  NotebookPen,
  Pencil,
  PenLine,
  Pin,
  Plus,
  UserPlus,
} from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChannelSummaryPanel, SummarizeMenu } from "@/components/ai/channel-summary";
import { BoardTab } from "@/components/board/board-tab";
import { CanvasTab } from "@/components/canvas/canvas-tab";
import { Composer } from "@/components/chat/composer";
import { FilesTab } from "@/components/chat/files-tab";
import { MessageList } from "@/components/chat/message-list";
import { ProfilePopover } from "@/components/chat/profile-popover";
import { SearchPanel } from "@/components/chat/search-panel";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { UserAvatar } from "@/components/chat/user-avatar";
import { CallButtons } from "@/components/calls";
import { BookmarksBar } from "@/components/messaging/bookmarks-bar";
import { PinsPanel, usePins } from "@/components/messaging/pins";
import { activeStatus, useNow } from "@/components/profile/profile-utils";
import { StatusEmoji } from "@/components/profile/status-emoji";
import { ChannelDetailsDialog, type DetailsTab } from "@/components/workspace/channel-details";
import {
  ChannelBell,
  ChannelMoreMenu,
  ChannelSearchButton,
  MemberCountButton,
  StarButton,
} from "@/components/workspace/channel-header-actions";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { WhiteboardTab } from "@/components/whiteboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessageJump } from "@/hooks/use-message-jump";
import type { SummaryRange } from "@/lib/ai";
import { api, type Message } from "@/lib/api";
import { applyMessageEvent, upsert } from "@/lib/messages";
import { setTabHidden, useHiddenTabs } from "@/lib/tab-prefs";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type Tab = "messages" | "canvas" | "board" | "whiteboard" | "files";

/** `channelsOnly` tabs are hidden in 1:1 DMs; `groupDMs` brings one back for group DMs. */
const TABS: {
  key: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  channelsOnly?: boolean;
  groupDMs?: boolean;
}[] = [
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "canvas", label: "Canvas", icon: NotebookPen, channelsOnly: true },
  { key: "board", label: "Board", icon: KanbanSquare, channelsOnly: true },
  { key: "whiteboard", label: "Whiteboard", icon: PenLine, channelsOnly: true, groupDMs: true },
  { key: "files", label: "Files", icon: FileText },
];

const TAB_KEYS: readonly Tab[] = ["messages", "canvas", "board", "whiteboard", "files"];

export function ChannelView() {
  const { channelId } = useParams<{ channelId: string }>();
  const search = useSearchParams();
  const tabParam = search.get("tab");
  const initialTab = TAB_KEYS.find((t) => t === tabParam) ?? "messages";
  const focusCardId = initialTab === "board" ? search.get("card") : null;
  // Keyed so all per-channel state starts fresh when switching channels (or following a deep link
  // to a specific tab / card, e.g. from a Lists mention in Activity).
  return (
    <ChannelPane
      key={`${channelId}:${tabParam ?? ""}:${focusCardId ?? ""}`}
      channelId={channelId}
      initialTab={initialTab}
      focusCardId={focusCardId}
    />
  );
}

function ChannelPane({
  channelId,
  initialTab,
  focusCardId,
}: {
  channelId: string;
  initialTab: Tab;
  focusCardId: string | null;
}) {
  const ws = useWorkspace();
  const { markRead, channelsLoaded } = ws;
  const channel = ws.channels.find((c) => c.id === channelId);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  // True after jumping to an old message: newer history isn't loaded yet (scroll down or
  // "Jump to latest" loads it), so live messages must not be appended after the gap.
  const [hasNewer, setHasNewer] = useState(false);
  const hasNewerRef = useRef(false);
  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);
  const [notFound, setNotFound] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [thread, setThread] = useState<Message | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  // Tabs this person hid in this channel (the "+" at the end of the tab row brings them back).
  const hiddenTabs = useHiddenTabs(channelId);
  const [details, setDetails] = useState<DetailsTab | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [bookmarksShown, setBookmarksShown] = useState(true);
  const [summary, setSummary] = useState<SummaryRange | null>(null);
  const pins = usePins(channelId);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelsRef = useRef(ws.channels);
  const messagesRef = useRef(messages);
  useEffect(() => {
    channelsRef.current = ws.channels;
    messagesRef.current = messages;
  });

  // Catch up on messages that arrived while the tab was in the background, and never fire a
  // pending mark-read after this pane is gone.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") markRead(channelId);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = null;
    };
  }, [channelId, markRead]);

  const loadMembers = useCallback(
    () => api<string[]>(`/channels/${channelId}/members`).then(setMemberIds),
    [channelId],
  );

  useEffect(() => {
    // Wait for the channel list (hard reload) so the unread count for the "New" divider is known.
    if (!channelsLoaded) return;
    let live = true;
    const unreadAtOpen = channelsRef.current.find((c) => c.id === channelId)?.unread_count ?? 0;
    // join is idempotent; it subscribes us to realtime events for public channels we open.
    api(`/channels/${channelId}/join`, { method: "POST" })
      .then(() => api<Message[]>(`/channels/${channelId}/messages?limit=${PAGE_SIZE}`))
      .then((page) => {
        if (!live) return;
        const ordered = page.reverse();
        setMessages(ordered);
        setHasMore(page.length === PAGE_SIZE);
        setHasNewer(false);
        setLoading(false);
        if (unreadAtOpen > 0) setFirstUnreadId(ordered[Math.max(0, ordered.length - unreadAtOpen)]?.id ?? null);
        markRead(channelId);
        loadMembers();
      })
      .catch(() => live && setNotFound(true));
    return () => {
      live = false;
    };
  }, [channelId, channelsLoaded, markRead, loadMembers]);

  const historyUrl = (query: string) => `/channels/${channelId}/messages?limit=${PAGE_SIZE}${query}`;

  // Older page (scrolling up). Pages use a (created_at, id) cursor, so nothing is skipped.
  const loadOlder = async () => {
    const current = messagesRef.current;
    if (!current.length) return;
    const page = await api<Message[]>(historyUrl(`&before_id=${current[0].id}`));
    setMessages((m) => [...page.reverse(), ...m]);
    setHasMore(page.length === PAGE_SIZE);
  };

  // Newer page (scrolling down after a jump).
  const loadNewer = async () => {
    const current = messagesRef.current;
    if (!current.length) return;
    const page = await api<Message[]>(historyUrl(`&after_id=${current[current.length - 1].id}`));
    setMessages((m) => page.reverse().reduce(upsert, m));
    if (page.length < PAGE_SIZE) setHasNewer(false);
  };

  // Jump to any message, however old: load the window around it.
  const loadAround = async (id: string) => {
    const page = await api<Message[]>(historyUrl(`&around_id=${id}`));
    setMessages(page.reverse());
    setHasMore(true); // the next scroll-up finds out whether anything is older
    setHasNewer(true);
    setFirstUnreadId(null);
  };

  const jumpToLatest = async () => {
    const page = await api<Message[]>(historyUrl(""));
    setMessages(page.reverse());
    setHasMore(page.length === PAGE_SIZE);
    setHasNewer(false);
  };

  // After a reconnect: page forward from our newest message until caught up. A very long gap
  // (laptop asleep over a busy day) just reloads the latest page instead.
  const catchUp = async () => {
    let last = messagesRef.current[messagesRef.current.length - 1];
    if (!last) return;
    for (let i = 0; i < 5; i++) {
      const page = await api<Message[]>(`/channels/${channelId}/messages?limit=100&after_id=${last.id}`);
      if (!page.length) return;
      const ordered = page.reverse();
      setMessages((m) => ordered.reduce(upsert, m));
      if (page.length < 100) return;
      last = ordered[ordered.length - 1];
    }
    await jumpToLatest();
  };

  // Sending while viewing old history: come back to the present first.
  const onOwnMessage = (m: Message) => {
    if (hasNewerRef.current) jumpToLatest().catch(() => {});
    else setMessages((list) => upsert(list, m));
  };

  useWorkspaceEvents((e) => {
    const scope = { channelId, parentId: null };
    // Viewing older history after a jump: a new top-level message belongs after the unloaded gap.
    const detachedNew =
      hasNewerRef.current && e.type === "message.created" && e.message.channel_id === channelId && !e.message.parent_id;
    if (!detachedNew) setMessages((list) => applyMessageEvent(list, e, scope));
    setThread((t) => (t ? (applyMessageEvent([t], e, scope)[0] ?? null) : t));
    if (
      e.type === "message.created" &&
      e.message.channel_id === channelId &&
      e.message.author_id !== ws.me?.id &&
      document.visibilityState === "visible" &&
      !readTimer.current
    ) {
      readTimer.current = setTimeout(() => {
        readTimer.current = null;
        markRead(channelId);
      }, 1500);
    }
    if (
      (e.type === "channel.joined" || e.type === "channel.member_joined" || e.type === "channel.member_left") &&
      e.channel_id === channelId
    )
      loadMembers().catch(() => {});
    if (e.type === "resync") {
      // Events may have been missed while disconnected: fetch everything after our newest message.
      if (!hasNewerRef.current) catchUp().catch(() => {});
      loadMembers().catch(() => {});
      if (document.visibilityState === "visible") markRead(channelId);
    }
  });


  const openThread = (m: Message) => {
    ws.setSearchQuery(null);
    setPinsOpen(false);
    setSummary(null);
    setThread(m);
  };
  const { highlightId, threadHighlightId } = useMessageJump({ messages, loading, loadAround, openThread });

  if (notFound) {
    return (
      <div className="m-auto p-8 text-center">
        <p className="font-bold">Channel not found</p>
        <p className="text-sm text-muted-foreground">It may have been removed, or you don&apos;t have access.</p>
      </div>
    );
  }

  const isDM = channel?.kind === "dm";
  const label = channel ? ws.channelLabel(channel) : "";
  const Icon = channel?.kind === "private" ? Lock : Hash;
  const others = isDM ? channel.member_ids.filter((id) => id !== ws.me?.id) : [];
  const dmPeer = isDM ? (others[0] ?? ws.me?.id) : undefined;
  const isGroupDM = isDM && others.length >= 2;
  const visibleTabs = TABS.filter((t) => !(isDM && t.channelsOnly && !(isGroupDM && t.groupDMs)));
  const shownTabs = visibleTabs.filter((t) => t.key === "messages" || !hiddenTabs.includes(t.key));
  const toggleTab = (key: Tab, hide: boolean) => {
    setTabHidden(channelId, key, hide);
    if (hide && tab === key) setTab("messages");
    if (!hide) setTab(key);
  };
  const showTab = (key: Tab) => visibleTabs.some((t) => t.key === key);

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b">
          <div className="flex h-[52px] items-center gap-2 px-3 sm:px-4">
            <Link
              href={`/w/${ws.workspaceId}`}
              aria-label="Back to channels and messages"
              className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted md:hidden"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
            {channel && <StarButton channel={channel} label={isDM ? label : `#${label}`} />}
            {isDM ? (
              dmPeer && (
                // The popover trigger is an inline button; this grid cell gives it a width to truncate in.
                <div className="grid min-w-0 [&>*]:min-w-0">
                  <ProfilePopover userId={dmPeer}>
                    <span className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                      <UserAvatar
                        id={dmPeer}
                        name={label}
                        size="sm"
                        online={others.length <= 1 ? ws.online.has(dmPeer) : undefined}
                      />
                      <span className="min-w-0 truncate text-lg font-black">{label}</span>
                      {others.length <= 1 && <StatusEmoji userId={dmPeer} className="text-base" />}
                    </span>
                  </ProfilePopover>
                </div>
              )
            ) : (
              <button
                onClick={() => setDetails("about")}
                // The name keeps its width (up to 16rem); the topic beside it truncates first.
                className="flex max-w-[16rem] min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-lg font-black hover:bg-muted"
              >
                <Icon className="size-[18px] shrink-0" />
                <span className="truncate">{label}</span>
                <ChevronDown className="size-4 shrink-0" />
              </button>
            )}
            {isDM && others.length <= 1 && dmPeer && <DmMeta userId={dmPeer} />}
            {channel?.topic && !isDM && (
              <span className="hidden min-w-0 flex-1 truncate text-[13px] text-muted-foreground lg:block">{channel.topic}</span>
            )}
            <div className="ml-auto" />
            {/* Phones: Summarize and pins live in the channel menu's space; keep the header to name + call. */}
            {channel && (
              <div className="hidden sm:contents">
                <SummarizeMenu
                  active={!!summary && !ws.searchQuery}
                  onPick={(r) => {
                    ws.setSearchQuery(null);
                    setPinsOpen(false);
                    setSummary(r);
                  }}
                />
              </div>
            )}
            {channel && !isDM && <MemberCountButton count={memberIds.length} onClick={() => setDetails("members")} />}
            {channel && <CallButtons channelId={channel.id} isDM={channel.kind === "dm"} className="shrink-0" />}
            {channel && <ChannelBell channel={channel} label={isDM ? label : `#${label}`} />}
            {channel && (
              <ChannelSearchButton
                label={isDM ? label : `#${label}`}
                onSearch={() => {
                  setPinsOpen(false);
                  setSummary(null);
                  ws.setSearchQuery(`in:${channel.id}`);
                }}
              />
            )}
            {channel && (
              <ChannelMoreMenu channel={channel} label={isDM ? label : `#${label}`} isDM={isDM} onDetails={setDetails} />
            )}
          </div>
          <nav
            role="tablist"
            aria-label="Conversation views"
            className="flex gap-1 overflow-x-auto px-3 text-[13px] [scrollbar-width:none] sm:px-4"
          >
            {shownTabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2 pt-1 pb-2.5 font-bold whitespace-nowrap md:pt-0 md:pb-2",
                  tab === t.key ? "border-tab" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
            {/* Like Slack: Pins and Bookmarks sit with the tabs (they open a panel / show the bookmarks row). */}
            {channel && (
              <button
                type="button"
                aria-pressed={pinsOpen && !ws.searchQuery}
                onClick={() => {
                  ws.setSearchQuery(null);
                  setSummary(null);
                  setPinsOpen((o) => !o);
                }}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2 pt-1 pb-2.5 font-bold whitespace-nowrap md:pt-0 md:pb-2",
                  pinsOpen && !ws.searchQuery ? "border-tab" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Pin className="size-3.5" aria-hidden /> Pins
                {(pins.pins?.length ?? 0) > 0 && <span className="text-xs font-semibold text-muted-foreground">{pins.pins?.length}</span>}
              </button>
            )}
            {channel && (
              <button
                type="button"
                aria-pressed={bookmarksShown}
                onClick={() => setBookmarksShown((v) => !v)}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 pt-1 pb-2.5 font-bold whitespace-nowrap md:pt-0 md:pb-2",
                  bookmarksShown ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Bookmark className={cn("size-3.5", bookmarksShown && "fill-current")} aria-hidden /> Bookmarks
              </button>
            )}
            {channel && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Add a tab"
                  className="-mb-px flex shrink-0 items-center rounded-md px-2 pt-1 pb-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 md:pt-0 md:pb-2"
                >
                  <Plus className="size-4" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Tabs in this conversation</DropdownMenuLabel>
                    {visibleTabs
                      .filter((t) => t.key !== "messages")
                      .map((t) => {
                        const on = !hiddenTabs.includes(t.key);
                        return (
                          <DropdownMenuItem key={t.key} onClick={() => toggleTab(t.key, on)}>
                            <t.icon className="size-4" aria-hidden />
                            <span className="flex-1">{t.label}</span>
                            {on && <Check className="size-4" aria-hidden />}
                          </DropdownMenuItem>
                        );
                      })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setBookmarksShown(true)}>
                    <Bookmark className="size-4" aria-hidden />
                    Add a bookmark
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </header>
        {channel && bookmarksShown && <BookmarksBar channelId={channelId} readOnly={channel.is_archived} />}

        {tab === "files" ? (
          <FilesTab channelId={channelId} />
        ) : tab === "canvas" && !isDM ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <CanvasTab channelId={channelId} />
          </div>
        ) : tab === "board" && !isDM ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <BoardTab channelId={channelId} readOnly={channel?.is_archived ?? false} initialCardId={focusCardId} />
          </div>
        ) : tab === "whiteboard" && showTab("whiteboard") ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <WhiteboardTab channelId={channelId} />
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              loading={loading}
              hasMore={hasMore}
              onLoadOlder={loadOlder}
              hasNewer={hasNewer}
              onLoadNewer={loadNewer}
              onJumpToLatest={jumpToLatest}
              onOpenThread={openThread}
              firstUnreadId={firstUnreadId}
              highlightId={highlightId}
              header={
                channel && (
                  <div className="px-4 pt-10 pb-6 sm:px-5">
                    {isDM && dmPeer ? (
                      <div className="flex items-end gap-3">
                        <UserAvatar id={dmPeer} name={label} size="xl" />
                        <div className="min-w-0">
                          <h2 className="text-xl font-black [overflow-wrap:anywhere] sm:text-2xl">{label}</h2>
                          <p className="text-[15px] text-muted-foreground">
                            This conversation is just between you and{" "}
                            <strong className="text-foreground">{others.length ? label : "yourself"}</strong>.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-mention text-mention-foreground">
                          <Icon className="size-7" />
                        </div>
                        <h2 className="text-2xl font-black [overflow-wrap:anywhere] sm:text-3xl">
                          {channel.kind === "private" ? "🔒" : "#"} {label}
                        </h2>
                        <p className="mt-1 text-[15px] text-muted-foreground [overflow-wrap:anywhere]">
                          This is the very beginning of the <strong className="text-foreground">{label}</strong> channel.{" "}
                          {channel.topic}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => setDetails("about")}
                            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-bold hover:bg-muted"
                          >
                            <Pencil className="size-3.5" /> {channel.topic ? "Edit topic" : "Add a topic"}
                          </button>
                          <button
                            onClick={() => setDetails("members")}
                            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-bold hover:bg-muted"
                          >
                            <UserPlus className="size-3.5" /> Add people
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )
              }
            />
            {channel?.is_archived ? (
              <div className="mx-3 mb-3 flex shrink-0 items-center justify-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground sm:mx-5 sm:mb-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <Archive className="size-4 shrink-0" />
                <span>
                  You&apos;re viewing an archived channel. <strong className="text-foreground">#{label}</strong> is read-only.
                </span>
              </div>
            ) : (
              <Composer
                key={channelId}
                channelId={channelId}
                placeholder={isDM ? `Message ${label}` : `Message #${label}`}
                autoFocus
                onSent={onOwnMessage}
              />
            )}
          </>
        )}
      </section>

      {/* A new search wins over an open thread (opening a thread clears the search); closing
          the search brings the thread back. */}
      {ws.searchQuery ? (
        <SearchPanel key={ws.searchQuery} query={ws.searchQuery} onClose={() => ws.setSearchQuery(null)} />
      ) : summary ? (
        <ChannelSummaryPanel
          channelId={channelId}
          range={summary}
          onRangeChange={setSummary}
          onClose={() => setSummary(null)}
          onPosted={onOwnMessage}
        />
      ) : pinsOpen ? (
        <PinsPanel state={pins} channelName={isDM ? label : `#${label}`} onClose={() => setPinsOpen(false)} />
      ) : (
        thread && (
          <ThreadPanel
            parent={thread}
            channelName={isDM ? label : `#${label}`}
            highlightId={threadHighlightId}
            onClose={() => setThread(null)}
          />
        )
      )}

      {channel && !isDM && details && (
        <ChannelDetailsDialog
          channel={channel}
          memberIds={memberIds}
          open
          tab={details}
          onTabChange={setDetails}
          onOpenChange={(o) => !o && setDetails(null)}
          onMembersChanged={loadMembers}
        />
      )}
    </div>
  );
}

/** "Status text · Title" next to a 1:1 DM's name in the header. */
function DmMeta({ userId }: { userId: string }) {
  const { memberById, me } = useWorkspace();
  const now = useNow();
  const profile = memberById[userId] ?? (me?.id === userId ? me : undefined);
  const status = activeStatus(profile, now);
  const parts = [status?.text, profile?.title].filter(Boolean);
  if (!parts.length) return null;
  return (
    <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground sm:block">{parts.join(" · ")}</span>
  );
}
