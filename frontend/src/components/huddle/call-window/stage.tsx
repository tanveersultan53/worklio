"use client";

import type { Room } from "livekit-client";
import { KanbanSquare, LoaderCircle, PenLine, ScreenShareOff, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import type { AnnotationOp } from "@/components/annotate";
import { BoardTab } from "@/components/board/board-tab";
import { hueFor, UserAvatar } from "@/components/chat/user-avatar";
import { useWorkspace } from "@/components/workspace/provider";
import { cn } from "@/lib/utils";

import { useHuddles } from "../huddle-provider";
import { ScreenTile, StageTile, useParticipantName } from "../participant-tile";
import type { HuddleParticipantView, HuddleRoomSnapshot } from "../types";
import { ReactionLayer } from "./reaction-layer";
import { getCallRoomData, type StageMode } from "./room-data";
import type { CallSignalsSnapshot } from "./signals";

const WhiteboardStage = dynamic(() => import("@/components/whiteboard").then((m) => m.WhiteboardStage), {
  ssr: false,
  loading: () => <StageLoading label="Opening the whiteboard…" />,
});

const Annotator = dynamic(() => import("@/components/annotate").then((m) => m.Annotator), { ssr: false });

const GAP = 10;
const MAX_GRID = 9;
/** Tiles may stretch between these aspect ratios (video is cropped to fill), so the grid has no letterboxing. */
const MIN_ASPECT = 1.0;
const MAX_ASPECT = 2.0;
const IDEAL_ASPECT = 16 / 9;

/** Observe an element's content box. Returns [callbackRef, size]. */
export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

/**
 * Pick the column count that gives the biggest tiles. Each tile fills its cell as long as the
 * cell's shape stays within MIN/MAX_ASPECT (video crops to fit), preferring shapes near 16:9.
 */
function fitGrid(n: number, w: number, h: number) {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, tw: 0, th: 0 };
  let best = { cols: 1, tw: 0, th: 0, score: -Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - GAP * (cols - 1)) / cols;
    const ch = (h - GAP * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let tw = cw;
    let th = ch;
    const a = cw / ch;
    if (a > MAX_ASPECT) tw = ch * MAX_ASPECT;
    else if (a < MIN_ASPECT) th = cw / MIN_ASPECT;
    const shape = Math.abs(Math.log(tw / th / IDEAL_ASPECT));
    // Empty cells in the last row cost a little, so 3 people prefer 3x1 / 2+1 sensibly.
    const empty = rows * cols - n;
    // Shape counts heavily: a tall tile crops away most of a 16:9 camera and upscales the rest.
    const score = tw * th * (1 - 0.45 * shape) * (1 - 0.04 * empty);
    if (score > best.score) best = { cols, tw, th, score };
  }
  return { cols: best.cols, tw: Math.floor(best.tw), th: Math.floor(best.th) };
}

export type StageProps = {
  mode: StageMode;
  snap: HuddleRoomSnapshot;
  signals: CallSignalsSnapshot;
  pinnedId: string | null;
  onPin: (id: string | null) => void;
  onShowPeople: () => void;
  connecting: boolean;
  channelId: string;
  readOnly: boolean;
  room: Room | null;
  annotating: boolean;
  onAnnotatingChange: (on: boolean) => void;
};

/** The call's main area: video grid, a shared screen, the whiteboard or the board. */
export function Stage(props: StageProps) {
  const { mode, snap, signals, connecting, onShowPeople } = props;
  const [stageRef, size] = useElementSize<HTMLDivElement>();
  const people = snap.participants;
  const sharer = people.find((p) => p.screenTrack) ?? null;
  const effective: StageMode = mode === "screen" && !sharer ? "video" : mode;
  // Filmstrip beside the content on wide stages, above it on narrow ones.
  const side = size.w >= 860 && size.w / Math.max(size.h, 1) > 1.3;

  let body: React.ReactNode;
  if (connecting && !people.length) {
    body = <Connecting />;
  } else if (effective === "video") {
    body = <VideoStage {...props} size={size} side={side} />;
  } else {
    body = (
      <WithFilmstrip {...props} side={side}>
        {effective === "screen" && sharer ? (
          <ScreenStage {...props} sharer={sharer} />
        ) : effective === "whiteboard" ? (
          <div data-call-keys="own" className="relative size-full overflow-hidden rounded-2xl bg-background ring-1 ring-white/10">
            <WhiteboardStage channelId={props.channelId} compact theme="dark" />
          </div>
        ) : (
          <BoardStage channelId={props.channelId} readOnly={props.readOnly} />
        )}
      </WithFilmstrip>
    );
  }

  const alone = !connecting && people.length === 1 && effective === "video";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {alone && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-zinc-900/80 py-1 pr-1 pl-3 text-xs text-white/85 ring-1 ring-white/10 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-2 duration-300">
            <span>You&apos;re the only one here</span>
            <button
              type="button"
              onClick={onShowPeople}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-semibold text-white outline-none hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <UserPlus className="size-3.5" aria-hidden />
              Invite people
            </button>
          </div>
        </div>
      )}
      <div ref={stageRef} className="relative min-h-0 flex-1">
        <div
          key={effective}
          className="absolute inset-0 animate-in fade-in-0 zoom-in-[0.985] duration-300 ease-out motion-reduce:animate-none"
        >
          {body}
        </div>
      </div>
      <ReactionLayer reactions={signals.reactions} />
    </div>
  );
}

// --- Video ---

function VideoStage({
  snap,
  signals,
  pinnedId,
  onPin,
  onShowPeople,
  size,
  side,
}: StageProps & { size: { w: number; h: number }; side: boolean }) {
  const people = snap.participants;
  const pinned = pinnedId ? (people.find((p) => p.identity === pinnedId) ?? null) : null;
  const togglePin = (id: string) => onPin(pinnedId === id ? null : id);

  if (pinned && people.length > 1) {
    const film = people.filter((p) => p.identity !== pinned.identity);
    return (
      <div className={cn("flex size-full min-h-0 gap-2.5", side ? "flex-row" : "flex-col-reverse")}>
        <div className="relative min-h-0 min-w-0 flex-1" role="list" aria-label="Spotlight">
          <StageTile
            p={pinned}
            hand={pinned.identity in signals.hands}
            pinned
            onTogglePin={() => togglePin(pinned.identity)}
            variant="spotlight"
            className="size-full"
          />
        </div>
        <Filmstrip people={film} signals={signals} pinnedId={pinnedId} onPin={onPin} side={side} />
      </div>
    );
  }

  const overflow = people.length > MAX_GRID ? people.slice(MAX_GRID - 1) : [];
  const shown = overflow.length ? people.slice(0, MAX_GRID - 1) : people;
  const count = shown.length + (overflow.length ? 1 : 0);
  const { tw, th } = fitGrid(count, size.w, size.h);
  const tileStyle = { width: tw, height: th };
  return (
    <div role="list" aria-label="Participants" className="flex size-full flex-wrap content-center justify-center" style={{ gap: GAP }}>
      {tw > 0 &&
        shown.map((p) => (
          <StageTile
            key={p.identity}
            p={p}
            hand={p.identity in signals.hands}
            pinned={false}
            onTogglePin={people.length > 1 ? () => togglePin(p.identity) : undefined}
            style={tileStyle}
            className="transition-[width,height,box-shadow] duration-300 ease-out motion-reduce:transition-none"
          />
        ))}
      {tw > 0 && overflow.length > 0 && <OverflowTile people={overflow} style={tileStyle} onClick={onShowPeople} />}
    </div>
  );
}

// --- Filmstrip ---

function WithFilmstrip({
  snap,
  signals,
  pinnedId,
  onPin,
  side,
  children,
}: StageProps & { side: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex size-full min-h-0 gap-2.5", side ? "flex-row" : "flex-col-reverse")}>
      <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
      <Filmstrip people={snap.participants} signals={signals} pinnedId={pinnedId} onPin={onPin} side={side} />
    </div>
  );
}

function Filmstrip({
  people,
  signals,
  pinnedId,
  onPin,
  side,
}: {
  people: HuddleParticipantView[];
  signals: CallSignalsSnapshot;
  pinnedId: string | null;
  onPin: (id: string | null) => void;
  side: boolean;
}) {
  if (!people.length) return null;
  // Speakers first, so the person talking is always in view.
  const ordered = [...people].sort((a, b) => Number(b.speaking) - Number(a.speaking));
  return (
    <div
      role="list"
      aria-label="Participants"
      className={cn(
        "flex shrink-0 gap-2 [scrollbar-width:thin]",
        side ? "w-44 flex-col overflow-y-auto pr-0.5 xl:w-52" : "h-[76px] flex-row overflow-x-auto pb-0.5 sm:h-[96px]",
      )}
    >
      {ordered.map((p) => (
        <StageTile
          key={p.identity}
          p={p}
          hand={p.identity in signals.hands}
          pinned={pinnedId === p.identity}
          onTogglePin={() => onPin(pinnedId === p.identity ? null : p.identity)}
          variant="film"
          className={cn("shrink-0", side ? "aspect-video w-full" : "aspect-video h-full")}
        />
      ))}
    </div>
  );
}

// --- Screen share ---

function ScreenStage({
  sharer,
  room,
  annotating,
  onAnnotatingChange,
}: StageProps & { sharer: HuddleParticipantView }) {
  const { toggleScreenShare } = useHuddles();
  const { name } = useParticipantName(sharer);
  const shareKey = `${sharer.identity}:${sharer.screenTrack?.sid ?? "screen"}`;
  return (
    <div className="relative size-full">
      <ScreenTile p={sharer} className="size-full" badge={!sharer.isLocal}>
        {room && (
          <ScreenAnnotations
            key={shareKey}
            room={room}
            shareKey={shareKey}
            active={annotating}
            onActiveChange={onAnnotatingChange}
          />
        )}
      </ScreenTile>

      {sharer.isLocal && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3">
          <div
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-emerald-500/95 py-1 pr-1 pl-3 text-xs font-semibold text-emerald-950 shadow-[0_10px_30px_-8px_rgb(16_185_129/0.6)] animate-in fade-in-0 slide-in-from-top-2 duration-300"
          >
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-950/50 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-950" />
            </span>
            You&apos;re presenting
            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-950 px-2.5 py-1 text-white outline-none hover:bg-emerald-900 focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <ScreenShareOff className="size-3.5" aria-hidden />
              Stop
            </button>
          </div>
        </div>
      )}

      {!annotating && room && (
        <button
          type="button"
          onClick={() => onAnnotatingChange(true)}
          className="absolute right-3 bottom-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur-xl outline-none transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label={`Annotate ${sharer.isLocal ? "your" : `${name}'s`} screen`}
        >
          <PenLine className="size-3.5" aria-hidden />
          Annotate
        </button>
      )}
    </div>
  );
}

function ScreenAnnotations({
  room,
  shareKey,
  active,
  onActiveChange,
}: {
  room: Room;
  shareKey: string;
  active: boolean;
  onActiveChange: (on: boolean) => void;
}) {
  const { me, memberById } = useWorkspace();
  const data = getCallRoomData(room);
  const send = useCallback((op: AnnotationOp) => data.sendAnnotation(shareKey, op), [data, shareKey]);
  const subscribe = useCallback(
    (fn: (op: AnnotationOp) => void) => data.subscribeAnnotations(shareKey, fn),
    [data, shareKey],
  );
  const id = me?.id ?? room.localParticipant.identity;
  const user = { id, name: me?.full_name ?? "You", color: `hsl(${hueFor(id)} 90% 62%)` };
  const resolveUser = useCallback(
    (userId: string) => {
      const m = memberById[userId];
      return m ? { name: m.full_name.split(" ")[0], color: `hsl(${hueFor(userId)} 90% 62%)` } : undefined;
    },
    [memberById],
  );
  return (
    <Annotator
      active={active}
      onActiveChange={onActiveChange}
      user={user}
      send={send}
      subscribe={subscribe}
      resolveUser={resolveUser}
      className="absolute inset-0 z-10"
    />
  );
}

// --- Board ---

function BoardStage({ channelId, readOnly }: { channelId: string; readOnly: boolean }) {
  return (
    <section
      data-call-keys="own"
      aria-label="Board"
      className="flex size-full min-h-0 flex-col overflow-hidden rounded-2xl bg-background text-foreground ring-1 ring-white/10"
    >
      <header className="flex items-center gap-2 border-b px-4 py-2.5 text-sm font-semibold">
        <KanbanSquare className="size-4 text-white/60" aria-hidden />
        Board
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
        <BoardTab channelId={channelId} readOnly={readOnly} />
      </div>
    </section>
  );
}

// --- Bits ---

function OverflowTile({
  people,
  style,
  onClick,
}: {
  people: HuddleParticipantView[];
  style: React.CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      aria-label={`${people.length} more people. Show everyone`}
      className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-white ring-1 ring-white/10 outline-none transition-[width,height] duration-300 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span className="flex -space-x-2">
        {people.slice(0, 3).map((p) => (
          <OverflowAvatar key={p.identity} p={p} />
        ))}
      </span>
      <span className="text-sm font-semibold">+{people.length} more</span>
    </button>
  );
}

function OverflowAvatar({ p }: { p: HuddleParticipantView }) {
  const { name } = useParticipantName(p);
  return <UserAvatar id={p.identity} name={name} size="lg" className="rounded-lg ring-2 ring-zinc-900" />;
}

function StageLoading({ label }: { label: string }) {
  return (
    <div className="flex size-full items-center justify-center gap-2 rounded-2xl bg-zinc-900/60 text-sm text-white/60 ring-1 ring-white/10" role="status">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {label}
    </div>
  );
}

function Connecting() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 text-white/70" role="status">
      <span className="relative flex size-12 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/25 motion-reduce:animate-none" />
        <span className="size-3 rounded-full bg-emerald-400" />
      </span>
      <span className="text-sm">Connecting…</span>
    </div>
  );
}

