"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import {
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderPlus,
  GripVertical,
  Hash,
  Link2,
  Lock,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  SquarePen,
  Star,
  StarOff,
  Trash2,
  Smile,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useId, useState } from "react";

import { useAppearance } from "@/components/appearance-provider";
import { ConfirmDialog } from "@/components/chat/confirm-dialog";
import { UserAvatar } from "@/components/chat/user-avatar";
import { HuddleIndicator } from "@/components/huddle";
import { StatusEmoji } from "@/components/profile/status-emoji";
import { EmojiPicker } from "@/components/chat/emoji-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, type Channel } from "@/lib/api";
import type { NotifyLevel } from "@/lib/appearance";
import { copyText } from "@/lib/clipboard";
import { useHasDraft } from "@/lib/drafts";
import {
  type ChannelNotifyLevel,
  createSection,
  deleteSection,
  reorderSections,
  setLocalCollapsed,
  type SidebarGroup,
  sidebarGroups,
  type SidebarSection,
  updateChannelPref,
  updateSection,
  useSidebarState,
} from "@/lib/sidebar";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./provider";

/* ------------------------------------------------------------- context */

type Actions = {
  /** Open the "Create section" dialog; the channel (if any) is moved into the new section. */
  newSection: (moveChannelId?: string) => void;
  renameSection: (id: string) => void;
  deleteSection: (section: SidebarSection) => void;
  leave: (channel: Channel) => void;
  addChannels: () => void;
  newMessage: () => void;
  renaming: string | null;
  setRenaming: (id: string | null) => void;
};

const ActionsCtx = createContext<Actions | null>(null);
const useActions = () => {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error("useActions outside <SidebarSections>");
  return a;
};

const MENU_POPUP =
  "z-50 max-h-(--available-height) min-w-52 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

/** Right-click (or long-press) menu around any sidebar row. */

/** A custom section's leading emoji (Slack shows it as the section icon), and the rest of its name. */
const SECTION_EMOJI = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*(.*)$/u;
export function splitSectionEmoji(name: string): { emoji: string | null; title: string } {
  const m = SECTION_EMOJI.exec(name.trim());
  return m && m[2] ? { emoji: m[1], title: m[2] } : { emoji: null, title: name };
}

export function RowContextMenu({ menu, children }: { menu: React.ReactNode; children: React.ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="group/row relative">{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="isolate z-50 outline-none">
          <ContextMenu.Popup data-slot="dropdown-menu-content" className={MENU_POPUP}>
            {menu}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/* --------------------------------------------------------------- root */

type DragItem = { type: "channel"; channel: Channel; from: string; label: string } | { type: "section"; section: SidebarSection };

/**
 * Starred, custom and default sections with drag & drop:
 * drag a conversation onto a section to move it (or onto Starred to star it); drag a custom section's grip to reorder.
 * Every drag action also has a keyboard path in the row / section menus.
 */
export function SidebarSections({
  view,
  onAddChannels,
  onNewMessage,
  onInvite,
}: {
  view: "home" | "dms";
  onAddChannels: () => void;
  onNewMessage: () => void;
  onInvite: () => void;
}) {
  const ws = useWorkspace();
  const sidebar = useSidebarState();
  const dndId = useId();
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [newSectionFor, setNewSectionFor] = useState<{ moveChannelId?: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SidebarSection | null>(null);
  const [leaving, setLeaving] = useState<Channel | null>(null);
  const router = useRouter();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groups: SidebarGroup[] = sidebarGroups(ws.channels, ws.channelLabel, sidebar);
  // While dragging a conversation, offer a Starred drop zone even if nothing is starred yet.
  if (dragging?.type === "channel" && !groups.some((g) => g.kind === "starred")) {
    groups.unshift({ key: "starred", kind: "starred", title: "Starred", items: [] });
  }
  const customIds = sidebar.sections.map((s) => `sec:${s.id}`);

  const leaveChannel = async (c: Channel) => {
    await api(`/channels/${c.id}/members/me`, { method: "DELETE" });
    await ws.reloadChannels();
    if (ws.activeChannelId === c.id) router.push(`/w/${ws.workspaceId}`);
    toast.success(`You left #${c.name}`);
  };

  const actions: Actions = {
    newSection: (moveChannelId) => setNewSectionFor({ moveChannelId }),
    renameSection: (id) => setRenaming(id),
    deleteSection: (s) => setDeleting(s),
    leave: (c) => {
      if (c.kind === "private") return setLeaving(c);
      leaveChannel(c).catch((e) => toast.error(errorMessage(e, "Couldn't leave the channel")));
    },
    addChannels: onAddChannels,
    newMessage: onNewMessage,
    renaming,
    setRenaming,
  };

  const collision: CollisionDetection = (args) => {
    const type = (args.active.data.current as DragItem | undefined)?.type;
    const want = type === "section" ? "section" : "drop";
    const droppableContainers = args.droppableContainers.filter((c) => c.data.current?.kind === want);
    return type === "section"
      ? closestCenter({ ...args, droppableContainers })
      : pointerWithin({ ...args, droppableContainers });
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as DragItem) ?? null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const item = e.active.data.current as DragItem | undefined;
    if (!item || !e.over) return;
    if (item.type === "section") {
      const from = customIds.indexOf(String(e.active.id));
      const to = customIds.indexOf(String(e.over.id));
      if (from < 0 || to < 0 || from === to) return;
      reorderSections(arrayMove(customIds, from, to).map((id) => id.slice(4)));
      return;
    }
    const target = e.over.data.current as { kind: "drop"; key: string; group: SidebarGroup["kind"] } | undefined;
    if (!target || target.key === item.from) return;
    if (target.group === "starred") updateChannelPref(item.channel.id, { starred: true });
    else if (target.group === "custom") updateChannelPref(item.channel.id, { starred: false, section_id: target.key });
    else updateChannelPref(item.channel.id, { starred: false, section_id: null });
  };

  const dms =
    view === "dms"
      ? ws.channels
          .filter((c) => c.kind === "dm")
          .sort((a, b) => b.unread_count - a.unread_count || ws.channelLabel(a).localeCompare(ws.channelLabel(b)))
      : [];

  return (
    <ActionsCtx.Provider value={actions}>
      {view === "dms" ? (
        <div className="mt-2 space-y-px">
          {dms.map((c) => (
            <ChannelRow key={c.id} channel={c} groupKey="dms" />
          ))}
          {ws.channelsLoaded && !dms.length && <p className="px-3 py-6 text-center text-sm opacity-70">No direct messages yet.</p>}
          {!ws.channelsLoaded && <SidebarSkeleton />}
          <AddRow label="New message" icon={SquarePen} onClick={onNewMessage} />
        </div>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Picked up ${dragLabel(active.data.current as DragItem)}.`,
              onDragOver: ({ active, over }) =>
                over ? `${dragLabel(active.data.current as DragItem)} is over ${String(over.data.current?.title ?? "a section")}.` : undefined,
              onDragEnd: ({ active, over }) =>
                over ? `Dropped ${dragLabel(active.data.current as DragItem)} on ${String(over.data.current?.title ?? "a section")}.` : "Dropped.",
              onDragCancel: ({ active }) => `Cancelled moving ${dragLabel(active.data.current as DragItem)}.`,
            },
          }}
        >
          {!ws.channelsLoaded && <SidebarSkeleton />}
          {ws.channelsLoaded && (
            <SortableContext items={customIds} strategy={verticalListSortingStrategy}>
              {groups.map((g) =>
                g.kind === "custom" ? (
                  <SortableGroup key={g.key} group={g} dragging={dragging} onInvite={onInvite} />
                ) : (
                  <GroupBlock key={g.key} group={g} dragging={dragging} onInvite={onInvite} />
                ),
              )}
            </SortableContext>
          )}
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="flex h-8 max-w-60 items-center gap-2 rounded-md bg-side-active px-2.5 text-sm font-bold text-side-active-foreground shadow-lg">
                {dragging.type === "channel" ? (
                  <>
                    {dragging.channel.kind === "dm" ? null : dragging.channel.kind === "private" ? (
                      <Lock className="size-3.5" />
                    ) : (
                      <Hash className="size-3.5" />
                    )}
                    <span className="truncate">{dragging.label}</span>
                  </>
                ) : (
                  <>
                    <GripVertical className="size-3.5" />
                    <span className="truncate">{dragging.section.name}</span>
                  </>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
      {sidebar.error && (
        <p className="mx-2 mt-3 rounded-md bg-side-hover px-2.5 py-1.5 text-xs opacity-80">
          Couldn&apos;t load your sidebar sections. Showing the defaults.
        </p>
      )}
      <NewSectionDialog
        open={!!newSectionFor}
        onOpenChange={(o) => !o && setNewSectionFor(null)}
        moveChannelId={newSectionFor?.moveChannelId}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description="Conversations in this section move back to Channels and Direct messages. Nobody else is affected."
        confirmLabel="Delete section"
        destructive
        onConfirm={async () => {
          if (deleting && !(await deleteSection(deleting.id))) throw new Error("Couldn't delete the section");
        }}
      />
      <ConfirmDialog
        open={!!leaving}
        onOpenChange={(o) => !o && setLeaving(null)}
        title={`Leave #${leaving?.name ?? ""}?`}
        description="This channel is private. You'll need to be invited again to rejoin."
        confirmLabel="Leave channel"
        destructive
        onConfirm={async () => {
          if (leaving) await leaveChannel(leaving);
        }}
      />
    </ActionsCtx.Provider>
  );
}

function dragLabel(item: DragItem | undefined) {
  if (!item) return "item";
  return item.type === "channel" ? item.label : `section ${item.section.name}`;
}

function SidebarSkeleton() {
  return (
    <div className="mt-3 space-y-2 px-2.5" aria-busy aria-label="Loading conversations">
      {[70, 55, 80, 45, 65].map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="size-4 rounded bg-side-hover" />
          <span className="h-3 animate-pulse rounded bg-side-hover" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- groups */

function SortableGroup(props: { group: SidebarGroup; dragging: DragItem | null; onInvite: () => void }) {
  const section = props.group.section!;
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: `sec:${section.id}`,
    data: { type: "section", section, kind: "section", title: section.name },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <GroupBlock {...props} handle={{ attributes, listeners }} />
    </div>
  );
}

type Handle = { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] };

function GroupBlock({
  group,
  dragging,
  handle,
  onInvite,
}: {
  group: SidebarGroup;
  dragging: DragItem | null;
  handle?: Handle;
  onInvite: () => void;
}) {
  const ws = useWorkspace();
  const sidebar = useSidebarState();
  const { prefs } = useAppearance();
  const actions = useActions();
  const compact = prefs.sidebar_compact;
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${group.key}`,
    data: { kind: "drop", key: group.key, group: group.kind, title: group.title },
  });

  const collapsed = group.section ? group.section.collapsed : !!sidebar.localCollapsed[group.key];
  const toggle = () => {
    if (group.section) updateSection(group.section.id, { collapsed: !collapsed });
    else setLocalCollapsed(group.key, !collapsed);
  };
  // Collapsed sections still show the open conversation and anything unread (like Slack).
  const shown = collapsed
    ? group.items.filter((c) => c.id === ws.activeChannelId || (c.unread_count > 0 && !sidebar.prefs[c.id]?.muted))
    : group.items;
  const isTarget = isOver && dragging?.type === "channel";
  const unreadHidden = collapsed && group.items.some((c) => c.unread_count > 0 && !sidebar.prefs[c.id]?.muted);
  const renaming = actions.renaming === group.key;

  return (
    <div
      ref={setNodeRef}
      className={cn("mt-3 rounded-md transition-colors", isTarget && "bg-side-hover ring-2 ring-side-active ring-inset")}
    >
      <div className="group/section flex items-center gap-0.5">
        {renaming && group.section ? (
          <RenameInput section={group.section} onDone={() => actions.setRenaming(null)} />
        ) : (
          <button
            onClick={toggle}
            aria-expanded={!collapsed}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 text-left hover:bg-side-hover",
              compact ? "py-1.5 text-[14px] md:py-0.5" : "py-2 text-[15px] md:py-1",
              unreadHidden && "font-bold text-side-strong",
            )}
          >
            {collapsed ? <ChevronRight className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
            {group.kind === "starred" && <Star className="size-3.5 shrink-0 fill-current opacity-80" />}
            {group.kind === "custom" && splitSectionEmoji(group.title).emoji && (
              <span aria-hidden className="shrink-0 text-[15px] leading-none">
                {splitSectionEmoji(group.title).emoji}
              </span>
            )}
            <span className="truncate font-medium">
              {group.kind === "custom" ? splitSectionEmoji(group.title).title : group.title}
            </span>
          </button>
        )}
        {handle && !renaming && (
          <button
            {...handle.attributes}
            {...handle.listeners}
            aria-label={`Reorder section ${group.title}`}
            title="Drag to reorder"
            className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md opacity-0 group-hover/section:opacity-70 hover:bg-side-hover focus-visible:opacity-100 active:cursor-grabbing [@media(pointer:coarse)]:hidden"
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        {!renaming && <SectionMenu group={group} onInvite={onInvite} />}
        {!renaming && (group.kind === "channels" || group.kind === "dms") && (
          <button
            type="button"
            onClick={group.kind === "dms" ? actions.newMessage : actions.addChannels}
            aria-label={group.kind === "dms" ? "New message" : "Add channels"}
            title={group.kind === "dms" ? "New message" : "Add channels"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 group-hover/section:opacity-80 hover:bg-side-hover hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-70"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>
      {(!collapsed || shown.length > 0) && (
        <div className="mt-0.5 space-y-px">
          {shown.map((c) => (
            <ChannelRow key={c.id} channel={c} groupKey={group.key} />
          ))}
          {!collapsed && group.kind === "custom" && !group.items.length && (
            <p className={cn("rounded-md border border-dashed border-current/20 px-2.5 text-xs opacity-60", compact ? "py-1" : "py-1.5")}>
              Drag conversations here, or use “Move to section” in a conversation&apos;s menu.
            </p>
          )}
          {!collapsed && group.kind === "starred" && !group.items.length && (
            <p className="rounded-md border border-dashed border-current/20 px-2.5 py-1.5 text-xs opacity-70">Drop here to star</p>
          )}
          {!collapsed && group.kind === "channels" && <AddRow label="Add channels" onClick={actions.addChannels} />}
          {!collapsed && group.kind === "dms" && (
            <AddRow label="Add coworkers" onClick={ws.isAdmin ? onInvite : actions.newMessage} />
          )}
        </div>
      )}
    </div>
  );
}

function RenameInput({ section, onDone }: { section: SidebarSection; onDone: () => void }) {
  const [name, setName] = useState(section.name);
  const save = () => {
    const v = name.trim();
    if (v && v !== section.name) updateSection(section.id, { name: v.slice(0, 80) });
    onDone();
  };
  return (
    <input
      autoFocus
      value={name}
      maxLength={80}
      aria-label="Section name"
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      className="mx-0.5 my-0.5 h-8 min-w-0 flex-1 rounded-md border border-side-active bg-background px-2 text-sm text-foreground outline-none md:h-7"
    />
  );
}

function SectionMenu({ group, onInvite }: { group: SidebarGroup; onInvite: () => void }) {
  const ws = useWorkspace();
  const sidebar = useSidebarState();
  const actions = useActions();
  const idx = group.section ? sidebar.sections.findIndex((s) => s.id === group.section!.id) : -1;
  const move = (dir: -1 | 1) => {
    const ids = sidebar.sections.map((s) => s.id);
    reorderSections(arrayMove(ids, idx, idx + dir));
  };
  const [emojiOpen, setEmojiOpen] = useState(false);
  const parts = group.section ? splitSectionEmoji(group.section.name) : null;
  const setEmoji = (emoji: string | null) => {
    if (!group.section || !parts) return;
    void updateSection(group.section.id, { name: emoji ? `${emoji} ${parts.title}` : parts.title });
  };
  return (
    <>
    <Dialog open={emojiOpen} onOpenChange={setEmojiOpen}>
      <DialogContent className="w-auto p-0 sm:max-w-fit" showCloseButton={false}>
        <DialogTitle className="sr-only">Choose an emoji for {parts?.title ?? group.title}</DialogTitle>
        <EmojiPicker
          onPick={(e) => {
            setEmoji(e);
            setEmojiOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${group.title} options`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 group-hover/section:opacity-80 hover:bg-side-hover focus-visible:opacity-100 data-popup-open:opacity-100 [@media(pointer:coarse)]:opacity-70"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {group.section && (
          <>
            <DropdownMenuItem onClick={() => actions.renameSection(group.key)}>
              <Pencil className="size-4" /> Rename section
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEmojiOpen(true)}>
              <Smile className="size-4" /> {parts?.emoji ? "Change emoji" : "Add an emoji"}
            </DropdownMenuItem>
            {parts?.emoji && (
              <DropdownMenuItem onClick={() => setEmoji(null)}>
                <X className="size-4" /> Remove emoji
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={idx <= 0} onClick={() => move(-1)}>
              <ArrowUp className="size-4" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={idx < 0 || idx >= sidebar.sections.length - 1} onClick={() => move(1)}>
              <ArrowDown className="size-4" /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {group.kind === "channels" && (
          <DropdownMenuItem onClick={actions.addChannels}>
            <Hash className="size-4" /> Browse channels
          </DropdownMenuItem>
        )}
        {group.kind === "dms" && (
          <>
            <DropdownMenuItem onClick={actions.newMessage}>
              <SquarePen className="size-4" /> New message
            </DropdownMenuItem>
            {ws.isAdmin && (
              <DropdownMenuItem onClick={onInvite}>
                <Plus className="size-4" /> Invite people
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuItem onClick={() => actions.newSection()}>
          <FolderPlus className="size-4" /> Create a section
        </DropdownMenuItem>
        {group.section && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => actions.deleteSection(group.section!)}>
              <Trash2 className="size-4" /> Delete section
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

function AddRow({
  label,
  onClick,
  icon: Icon = Plus,
}: {
  label: string;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const { prefs } = useAppearance();
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 hover:bg-side-hover",
        prefs.sidebar_compact ? "h-8 text-[14px] md:h-6" : "h-9 md:h-7",
      )}
    >
      <span className="flex size-5 items-center justify-center rounded bg-side-hover">
        <Icon className="size-3.5" />
      </span>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------- channel row */

function ChannelRow({ channel, groupKey }: { channel: Channel; groupKey: string }) {
  const ws = useWorkspace();
  const sidebar = useSidebarState();
  const { prefs } = useAppearance();
  const compact = prefs.sidebar_compact;
  const pref = sidebar.prefs[channel.id];
  const muted = !!pref?.muted;
  const active = channel.id === ws.activeChannelId;
  const unread = channel.unread_count > 0 && !active;
  const draft = useHasDraft(channel.id) && !active;
  const isDM = channel.kind === "dm";

  const others = isDM ? channel.member_ids.filter((id) => id !== ws.me?.id) : [];
  const single = isDM && others.length <= 1 ? (others[0] ?? ws.me?.id) : undefined;
  const isSelf = isDM && others.length === 0;
  const label = isSelf ? (ws.me?.full_name ?? "") : ws.channelLabel(channel);

  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `ch:${groupKey}:${channel.id}`,
    data: { type: "channel", channel, from: groupKey, label: isDM ? label : `#${label}` },
  });
  // Only the mouse starts a drag from a row: Enter/Space must keep following the link (menus offer "Move to").
  const mouseDown = (listeners as Record<string, React.MouseEventHandler> | undefined)?.onMouseDown;

  const leading = isDM ? (
    single ? (
      <UserAvatar
        id={single}
        name={ws.memberById[single]?.full_name ?? "?"}
        size="sm"
        online={ws.online.has(single)}
        ringClassName="border-side"
      />
    ) : (
      <span className="inline-flex size-5 items-center justify-center rounded bg-side-hover text-[10px] font-bold">{others.length}</span>
    )
  ) : channel.kind === "private" ? (
    <Lock className="size-4" />
  ) : (
    <Hash className="size-4" />
  );

  return (
    <div ref={setNodeRef} onMouseDown={mouseDown} className={cn(isDragging && "opacity-40")}>
      <RowContextMenu menu={<ChannelMenuItems channel={channel} />}>
        <Link
          href={`/w/${ws.workspaceId}/c/${channel.id}`}
          onClick={() => ws.setSidebarOpen(false)}
          draggable={false}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 pr-1.5",
            compact ? "h-8 text-[14px] md:h-6" : "h-9 md:h-7",
            active ? "bg-side-active text-side-active-foreground" : "hover:bg-side-hover",
            unread && !muted && "font-bold text-side-strong",
            muted && !active && "opacity-55",
          )}
        >
          <span className="flex w-5 shrink-0 justify-center">{leading}</span>
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="min-w-0 truncate">
              {label}
              {isSelf && <span className="ml-1 font-normal opacity-70">you</span>}
            </span>
            {single && !isSelf && <StatusEmoji userId={single} className="text-[13px]" />}
            {muted && <BellOff className="size-3 shrink-0 opacity-80" aria-label="Muted" />}
          </span>
          <HuddleIndicator channelId={channel.id} />
          <span className="flex shrink-0 items-center group-hover/row:hidden group-has-[[data-popup-open]]/row:hidden">
            {unread && isDM ? (
              <span
                className={cn(
                  "rounded-full px-2 text-xs leading-5 font-bold",
                  muted ? "bg-side-hover text-side-foreground" : "bg-badge text-badge-foreground",
                )}
              >
                {channel.unread_count > 99 ? "99+" : channel.unread_count}
              </span>
            ) : (
              draft && <Pencil className="size-3.5 opacity-70" aria-label="Draft" />
            )}
          </span>
          {/* Spacer the size of the ⋯ button so the label doesn't slide under it on hover. */}
          <span className="hidden w-6 shrink-0 group-hover/row:block group-has-[[data-popup-open]]/row:block" />
        </Link>
        <RowMenuButton label={label} channel={channel} />
      </RowContextMenu>
    </div>
  );
}

function RowMenuButton({ label, channel }: { label: string; channel: Channel }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Options for ${label}`}
        className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded opacity-0 group-hover/row:opacity-100 hover:bg-side-hover focus-visible:opacity-100 data-popup-open:opacity-100"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-56">
        <ChannelMenuItems channel={channel} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LEVEL_LABEL: Record<NotifyLevel, string> = { all: "All new messages", mentions: "Mentions & DMs", nothing: "Nothing" };
const LEVEL_SHORT: Record<NotifyLevel, string> = { all: "All", mentions: "Mentions", nothing: "Nothing" };

/** Shared items for the right-click menu and the ⋯ menu. */
function ChannelMenuItems({ channel }: { channel: Channel }) {
  const ws = useWorkspace();
  const sidebar = useSidebarState();
  const { prefs } = useAppearance();
  const actions = useActions();
  const pref = sidebar.prefs[channel.id];
  const isDM = channel.kind === "dm";
  const level: ChannelNotifyLevel = pref?.notify ?? "default";
  const globalLevel: NotifyLevel = prefs.desktop_notify ?? "mentions";
  const currentSection = pref?.starred ? "__starred" : (pref?.section_id ?? "__default");

  const copyLink = async () => {
    try {
      await copyText(`${window.location.origin}/w/${ws.workspaceId}/c/${channel.id}`);
      toast.success("Link copied");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't copy the link"));
    }
  };

  return (
    <>
      <DropdownMenuItem onClick={() => updateChannelPref(channel.id, { starred: !pref?.starred })}>
        {pref?.starred ? <StarOff className="size-4" /> : <Star className="size-4" />}
        {pref?.starred ? "Unstar" : "Star"} {isDM ? "conversation" : "channel"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => updateChannelPref(channel.id, { muted: !pref?.muted })}>
        {pref?.muted ? <Bell className="size-4" /> : <BellOff className="size-4" />}
        {pref?.muted ? "Unmute" : "Mute"} {isDM ? "conversation" : "channel"}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Bell className="size-4" /> Notifications
          <span className="ml-auto pl-2 text-xs text-muted-foreground">{pref?.muted ? "Muted" : level === "default" ? "Default" : LEVEL_SHORT[level]}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={level}
              onValueChange={(v) => updateChannelPref(channel.id, { notify: v as ChannelNotifyLevel })}
            >
              <DropdownMenuRadioItem value="default">
                Default
                <span className="ml-auto pl-2 text-xs text-muted-foreground">{LEVEL_SHORT[globalLevel]}</span>
              </DropdownMenuRadioItem>
              {(["all", "mentions", "nothing"] as const).map((l) => (
                <DropdownMenuRadioItem key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <FolderInput className="size-4" /> Move to section
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          <DropdownMenuRadioGroup
            value={currentSection}
            onValueChange={(v) => {
              if (v === currentSection) return;
              if (v === "__starred") updateChannelPref(channel.id, { starred: true });
              else updateChannelPref(channel.id, { starred: false, section_id: v === "__default" ? null : String(v) });
            }}
          >
            <DropdownMenuRadioItem value="__starred">
              <Star className="size-4" /> Starred
            </DropdownMenuRadioItem>
            {sidebar.sections.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id}>
                <span className="truncate">{s.name}</span>
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value="__default">{isDM ? "Direct messages" : "Channels"}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => actions.newSection(channel.id)}>
            <FolderPlus className="size-4" /> New section…
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={copyLink}>
        <Link2 className="size-4" /> Copy link
      </DropdownMenuItem>
      {!isDM && channel.is_member && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => actions.leave(channel)}>
            <LogOut className="size-4" /> Leave channel
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ dialogs */

function NewSectionDialog({
  open,
  onOpenChange,
  moveChannelId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  moveChannelId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <NewSectionForm moveChannelId={moveChannelId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const SECTION_IDEAS = ["Projects", "Team", "Clients", "Social", "Watching"];

function NewSectionForm({ moveChannelId, onDone }: { moveChannelId?: string; onDone: () => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!v || busy) return;
    setBusy(true);
    const created = await createSection(ws.workspaceId, v.slice(0, 80));
    setBusy(false);
    if (!created) return;
    if (moveChannelId) await updateChannelPref(moveChannelId, { starred: false, section_id: created.id });
    toast.success(`Created “${created.name}”`);
    onDone();
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Create a section</DialogTitle>
        <DialogDescription>Organise conversations your way. Only you see your sections.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Projects"
          aria-label="Section name"
          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap gap-1.5">
          {SECTION_IDEAS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setName(s)}
              className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <DialogFooter>
        <button type="button" onClick={onDone} className="h-9 rounded-md border px-3 text-sm font-bold hover:bg-muted">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="h-9 rounded-md bg-send px-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </DialogFooter>
    </form>
  );
}
