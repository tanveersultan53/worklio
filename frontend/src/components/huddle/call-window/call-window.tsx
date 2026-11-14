"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ConnectionQuality } from "livekit-client";
import {
  ChevronDown,
  Hash,
  Headphones,
  KanbanSquare,
  Lock,
  Maximize,
  MessagesSquare,
  Minimize,
  MonitorUp,
  NotebookPen,
  PenTool,
  Phone,
  Radio,
  ScrollText,
  Signal,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Users,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  CAPTIONS_UNSUPPORTED,
  CaptionsOverlay,
  useCaptionFeed,
  useLiveCaptions,
  useSpeechRecognitionSupported,
} from "@/components/ai/call-captions";
import { CallTranscriptPanel } from "@/components/ai/call-transcript";
import { UserAvatar } from "@/components/chat/user-avatar";
import { useWorkspace } from "@/components/workspace/provider";
import { decodeMentions } from "@/lib/format";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { EffectsDialogHost } from "../effects-host";
import { useHuddleRoom, useHuddles } from "../huddle-provider";
import { LG_QUERY, useIsDesktop, useMediaQuery } from "../hooks";
import { callHeaderLabel } from "./call-header-label";
import { ChatPanel, useCallChat } from "./chat-panel";
import { CallControls, Tip, type StageOption, useScreenShare } from "./controls";
import { NotesPanel } from "./notes-panel";
import { PeoplePanel } from "./people-panel";
import { getCallRoomData, type StageMode, useCallRoomData } from "./room-data";
import { getCallSignals, useCallSignals } from "./signals";
import { Stage } from "./stage";
import { CALL_THEME_CLASS, CALL_THEME_VARS } from "./theme";
import { isLiveCall, type SidePanelTab } from "./types";
import { useCallInfo } from "./use-call";

const PREFS_KEY = "worklio.callWindow";
type Prefs = { panelWidth: number };
const DEFAULT_PREFS: Prefs = { panelWidth: 360 };
const PANEL_MIN = 300;
const PANEL_MAX = 560;

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { panelWidth: typeof raw.panelWidth === "number" ? raw.panelWidth : DEFAULT_PREFS.panelWidth };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: Prefs) {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...raw, ...p }));
  } catch {
    // storage blocked; preferences just won't persist
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

function isTextEditing(el: Element | null) {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

const TAB_META: Record<SidePanelTab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  people: { label: "People", icon: Users },
  chat: { label: "Chat", icon: MessagesSquare },
  notes: { label: "Notes", icon: NotebookPen },
  transcript: { label: "Transcript", icon: ScrollText },
};

const STAGE_META: Record<StageMode, { label: string; noun: string; icon: React.ComponentType<{ className?: string }> }> = {
  video: { label: "Video", noun: "video", icon: Video },
  screen: { label: "Screen", noun: "shared screen", icon: MonitorUp },
  whiteboard: { label: "Whiteboard", noun: "whiteboard", icon: PenTool },
  board: { label: "Board", noun: "board", icon: KanbanSquare },
};

/**
 * The expanded call experience. A dark, glassy window with:
 *  - a STAGE that shows video (default), a shared screen (automatic, with live annotations),
 *    the channel whiteboard or the channel board, picked with the header's Stage switcher;
 *  - a control bar (mic/camera with device menus, share screen, annotate, reactions, hand, settings, leave);
 *  - one side panel with People · Chat · Notes.
 * Phone: full-screen overlay. Desktop: a large, resizable window (or full screen).
 * Rendered by <HuddleBar>; `open`/`onMinimize` come from there.
 */
export function CallWindow({
  channelId,
  open,
  onMinimize,
  elapsed,
}: {
  channelId: string;
  open: boolean;
  onMinimize: () => void;
  elapsed: string;
}) {
  const { status, room, toggleMic, toggleCamera, startAudio, callKind } = useHuddles();
  const snap = useHuddleRoom();
  const signals = useCallSignals(room);
  const roomData = useCallRoomData(room);
  const { call, invite, canInvite } = useCallInfo();
  const share = useScreenShare();
  const isDesktop = useIsDesktop();
  const wide = useMediaQuery(LG_QUERY, true);
  const { channels, channelLabel, me, memberById } = useWorkspace();
  const channel = channels.find((c) => c.id === channelId);
  const title = channel ? (channel.kind === "dm" ? channelLabel(channel) : channel.name) : "Call";
  const ChannelIcon = channel?.kind === "private" ? Lock : channel?.kind === "dm" ? null : Hash;
  const kind = call?.kind ?? callKind;
  const label = callHeaderLabel({
    kind,
    direct: channel?.kind === "dm",
    started: !!call,
    cameraOn: snap.participants.some((p) => p.cameraTrack !== null),
  });
  const KindIcon = label === "Video call" ? Video : label === "Audio call" ? Phone : Headphones;

  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<SidePanelTab | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<StageMode>("video");
  const [annotating, setAnnotating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [captionsOn, setCaptionsOn] = useState(false);

  const connecting = status === "connecting";
  const reconnecting = status === "reconnecting";
  const ended = !!call && !isLiveCall(call);
  const handRaised = !!me && me.id in signals.hands;

  // --- Screen share takes the stage automatically; it goes back to video when sharing stops ---
  const sharers = snap.participants.filter((p) => p.screenTrack).map((p) => p.identity);
  const shareKey = sharers.join(",");
  const [prevShareKey, setPrevShareKey] = useState("");
  if (shareKey !== prevShareKey) {
    const before = prevShareKey ? prevShareKey.split(",") : [];
    setPrevShareKey(shareKey);
    if (sharers.some((id) => !before.includes(id))) setStage("screen");
    if (!shareKey) {
      setAnnotating(false);
      if (stage === "screen") setStage("video");
    }
  }
  const screenShared = sharers.length > 0;
  const effectiveStage: StageMode = stage === "screen" && !screenShared ? "video" : stage;
  const stageOptions: StageOption[] = (["video", ...(screenShared ? ["screen"] : []), "whiteboard", "board"] as StageMode[]).map(
    (m) => ({ mode: m, label: STAGE_META[m].label, icon: STAGE_META[m].icon }),
  );
  const chooseStage = (m: StageMode) => {
    setStage(m);
    if (m !== "screen") setAnnotating(false);
    if (m !== "video") setPinnedId(null);
  };

  // --- Side panel ---
  const hasNotes = !!call;
  const hasChat = !!call?.message_id;
  const tabs: SidePanelTab[] = [
    "people",
    ...(hasChat ? (["chat"] as const) : []),
    ...(hasNotes ? (["notes", "transcript"] as const) : []),
  ];
  const activeTab = panel && tabs.includes(panel) ? panel : null;
  const chat = useCallChat(channelId, call?.message_id ?? null, open && activeTab === "chat", open);
  const defaultTab: SidePanelTab = hasChat ? "chat" : "people";
  const togglePanel = () => setPanel((cur) => (cur && tabs.includes(cur) ? null : defaultTab));
  const typingIds = Object.keys(roomData.chatTyping).filter((id) => id !== me?.id);

  // --- Live captions (CC): transcribe my mic while on; show everyone's captions over the stage ---
  const speechSupported = useSpeechRecognitionSupported();
  const captionsAvailable = !!call && !ended;
  const captionsShown = captionsOn && captionsAvailable;
  const captionsActive = captionsShown && speechSupported && snap.micEnabled && !connecting;
  const captionFeed = useCaptionFeed(call?.id ?? null, me?.id, captionsShown, captionsActive);
  useLiveCaptions({
    callId: call?.id ?? null,
    active: captionsActive,
    onLocal: captionFeed.pushLocal,
    onFatal: (message) => toast.error(message),
  });
  function toggleCaptions() {
    if (!captionsOn && !speechSupported) toast.info(`${CAPTIONS_UNSUPPORTED}. You'll still see everyone else's captions.`);
    setCaptionsOn(!captionsOn);
  }
  const captionsNotice = !captionsShown
    ? null
    : !speechSupported
      ? { kind: "unsupported" as const, text: CAPTIONS_UNSUPPORTED }
      : !snap.micEnabled
        ? { kind: "muted" as const, text: "Your captions are paused while you're muted" }
        : null;

  // --- "Bring everyone" presentations ---
  const presentation = roomData.presentation;
  const presenterName = presentation
    ? (memberById[presentation.identity]?.full_name.split(" ")[0] ?? "Someone")
    : "";
  const lastToasted = useRef(0);
  useEffect(() => {
    if (!presentation || open || lastToasted.current === presentation.id) return;
    lastToasted.current = presentation.id;
    toast.info(`${presenterName} is presenting the ${STAGE_META[presentation.mode].noun}. Open the call to view.`);
  }, [presentation, open, presenterName]);

  function bringEveryone() {
    if (!room) return;
    getCallRoomData(room).present(effectiveStage);
    setNotice(`Everyone was asked to view the ${STAGE_META[effectiveStage].noun}.`);
  }

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);

  // --- Desktop window resize (centered, so each side moves by the drag delta) ---
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  function onResizeDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !popupRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = popupRef.current.getBoundingClientRect();
    resize.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
  }
  function onResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = resize.current;
    if (!d) return;
    setSize({
      w: clamp(d.w + 2 * (e.clientX - d.x), 720, window.innerWidth - 24),
      h: clamp(d.h + 2 * (e.clientY - d.y), 480, window.innerHeight - 24),
    });
  }
  function onResizeUp() {
    resize.current = null;
  }

  // --- Side panel width drag ---
  const panelDrag = useRef<{ x: number; w: number } | null>(null);
  const panelWidth = clamp(prefs.panelWidth, PANEL_MIN, PANEL_MAX);
  function onPanelDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDrag.current = { x: e.clientX, w: panelWidth };
  }
  function onPanelMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = panelDrag.current;
    if (!d) return;
    setPrefs({ panelWidth: clamp(d.w - (e.clientX - d.x), PANEL_MIN, PANEL_MAX) });
  }
  function onPanelUp() {
    if (!panelDrag.current) return;
    panelDrag.current = null;
    writePrefs(prefs);
  }
  function onPanelKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 48 : 16;
    let next: number;
    if (e.key === "ArrowLeft") next = clamp(panelWidth + step, PANEL_MIN, PANEL_MAX);
    else if (e.key === "ArrowRight") next = clamp(panelWidth - step, PANEL_MIN, PANEL_MAX);
    else return;
    e.preventDefault();
    setPrefs({ panelWidth: next });
    writePrefs({ panelWidth: next });
  }

  // --- Keyboard shortcuts: M mic, V camera, S share, H hand, C panel (Cmd/Ctrl+D also mutes) ---
  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      void toggleMic();
      return;
    }
    if (mod || e.altKey || e.defaultPrevented || e.repeat) return;
    if (isTextEditing(target)) return;
    // Menus use letters for typeahead; the whiteboard and board have their own shortcuts.
    if (target.closest?.("[data-call-keys=own], [role=menu], [role=listbox], [data-slot=popover-content]")) return;
    // While annotating, letters pick drawing tools.
    if (annotating || connecting) return;
    const key = e.key.toLowerCase();
    if (key === "m") void toggleMic();
    else if (key === "v") void toggleCamera();
    else if (key === "s") void (snap.screenShareEnabled ? share.toggle() : share.start(false));
    else if (key === "h") {
      if (room) getCallSignals(room).setHand(!handRaised);
    } else if (key === "c") togglePanel();
    else return;
    e.preventDefault();
  }

  const windowed = isDesktop && !fullscreen;
  const popupStyle: React.CSSProperties = {
    ...CALL_THEME_VARS,
    ...(windowed && size ? { width: size.w, height: size.h } : null),
  };
  const tabsId = useId();
  const showPresentation = !!presentation && open && presentation.mode !== effectiveStage;

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (details.reason === "escape-key") {
          // Esc peels back one layer at a time: typing → annotating → side panel → window.
          if (isTextEditing(document.activeElement)) {
            details.cancel();
            (document.activeElement as HTMLElement | null)?.blur();
            return;
          }
          if (annotating) {
            details.cancel();
            setAnnotating(false);
            return;
          }
          if (activeTab) {
            details.cancel();
            setPanel(null);
            return;
          }
        }
        onMinimize();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-md duration-200",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          ref={popupRef}
          onKeyDown={onKeyDown}
          style={popupStyle}
          className={cn(
            CALL_THEME_CLASS,
            "fixed z-50 flex flex-col overflow-hidden bg-zinc-950/90 text-zinc-50 outline-none backdrop-blur-2xl",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-200 motion-reduce:animate-none",
            windowed
              ? "top-1/2 left-1/2 h-[min(860px,calc(100dvh-40px))] w-[min(1360px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 rounded-[20px] shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8)] ring-1 ring-white/10 data-open:zoom-in-[0.97] data-open:slide-in-from-bottom-4 data-closed:zoom-out-[0.97] data-closed:slide-out-to-bottom-4"
              : "inset-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom-8 data-closed:slide-out-to-bottom-8",
          )}
        >
          {/* Ambient light */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(1100px_520px_at_15%_-15%,rgb(16_185_129/0.10),transparent_60%),radial-gradient(900px_520px_at_110%_120%,rgb(99_102_241/0.14),transparent_60%)]"
          />

          {/* Header */}
          <header className="relative flex items-center gap-2.5 px-3 pt-3 pb-2 sm:px-4">
            <span
              className={cn(
                "relative flex size-9 shrink-0 items-center justify-center rounded-xl ring-1",
                connecting || reconnecting
                  ? "bg-amber-400/10 text-amber-300 ring-amber-300/20"
                  : "bg-emerald-400/10 text-emerald-300 ring-emerald-300/20",
              )}
              aria-hidden
            >
              <KindIcon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="flex items-center gap-1 truncate text-[15px] font-semibold tracking-tight">
                {ChannelIcon && <ChannelIcon className="size-3.5 shrink-0 opacity-50" aria-hidden />}
                <span className="truncate">{title}</span>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="flex items-center gap-1.5 text-xs text-white/55" aria-live="polite">
                {connecting ? (
                  <span className="text-amber-300">Connecting…</span>
                ) : reconnecting ? (
                  <span className="text-amber-300">Reconnecting…</span>
                ) : (
                  <>
                    <span className="relative flex size-1.5" aria-hidden>
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:animate-none" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                    </span>
                    <span className="hidden sm:inline">{label}</span>
                    <span aria-hidden className="hidden sm:inline">
                      ·
                    </span>
                    <span className="tabular-nums">{elapsed}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {snap.participants.length} {snap.participants.length === 1 ? "person" : "people"}
                    </span>
                    <QualityIcon quality={snap.quality} />
                  </>
                )}
              </DialogPrimitive.Description>
            </div>

            {isDesktop && (
              <StageSwitcher options={stageOptions} value={effectiveStage} onChange={chooseStage} showLabels={wide} />
            )}
            {isDesktop && (effectiveStage === "whiteboard" || effectiveStage === "board") && (
              <Tip
                label={`Ask everyone to view the ${STAGE_META[effectiveStage].noun}`}
                side="bottom"
                trigger={
                  <button
                    type="button"
                    onClick={bringEveryone}
                    disabled={!room || snap.participants.length < 2}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-indigo-500 px-3 text-xs font-semibold text-white shadow-[0_8px_24px_-8px_rgb(99_102_241/0.8)] outline-none transition hover:bg-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-200/70 disabled:opacity-40 animate-in fade-in-0 zoom-in-95 duration-200"
                  />
                }
              >
                <Radio className="size-3.5" aria-hidden />
                <span className={cn(!wide && "sr-only")}>Bring everyone</span>
              </Tip>
            )}

            {isDesktop && (
              <HeaderButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => setFullscreen((f) => !f)}>
                {fullscreen ? <Minimize /> : <Maximize />}
              </HeaderButton>
            )}
            <HeaderButton label="Minimize" keys="Esc" onClick={onMinimize}>
              <ChevronDown />
            </HeaderButton>
          </header>

          {/* Body */}
          <div className="relative flex min-h-0 flex-1">
            <div className="relative flex min-w-0 flex-1 flex-col px-2 pb-2 sm:px-3 sm:pb-3">
              {!snap.canPlayAudio && (
                <button
                  type="button"
                  onClick={() => void startAudio()}
                  className="mb-2 flex items-center justify-center gap-2 self-center rounded-full bg-amber-400 px-4 py-1.5 text-sm font-semibold text-amber-950 shadow-lg outline-none hover:bg-amber-300 focus-visible:ring-2 focus-visible:ring-amber-200/70 animate-in fade-in-0 slide-in-from-top-2"
                >
                  <Volume2 className="size-4" aria-hidden />
                  Your browser paused call audio. Click to listen.
                </button>
              )}

              <Stage
                mode={effectiveStage}
                snap={snap}
                signals={signals}
                pinnedId={pinnedId}
                onPin={setPinnedId}
                onShowPeople={() => setPanel("people")}
                connecting={connecting}
                channelId={channelId}
                readOnly={channel?.is_archived ?? false}
                room={room}
                annotating={annotating}
                onAnnotatingChange={setAnnotating}
              />


              {/* Floating notices over the stage */}
              <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex flex-col items-center gap-2 px-3">
                {showPresentation && presentation && (
                  <div
                    role="status"
                    key={presentation.id}
                    className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-zinc-900/90 py-1.5 pr-1.5 pl-2 text-sm text-white shadow-[0_20px_50px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-3 duration-300"
                  >
                    <UserAvatar id={presentation.identity} name={memberById[presentation.identity]?.full_name ?? presenterName} size="md" />
                    <span className="min-w-0">
                      <strong className="font-semibold">{presenterName}</strong> is presenting the{" "}
                      {STAGE_META[presentation.mode].noun}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        chooseStage(presentation.mode);
                        if (room) getCallRoomData(room).dismissPresentation(presentation.id);
                      }}
                      className="rounded-full bg-white px-3 py-1 text-xs font-bold text-zinc-900 outline-none hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={() => room && getCallRoomData(room).dismissPresentation(presentation.id)}
                      className="flex size-7 items-center justify-center rounded-full text-white/60 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </div>
                )}
                {notice && (
                  <div
                    role="status"
                    className="rounded-full bg-zinc-900/90 px-3 py-1.5 text-xs text-white/85 ring-1 ring-white/10 backdrop-blur-xl animate-in fade-in-0 slide-in-from-top-2 duration-200"
                  >
                    {notice}
                  </div>
                )}
              </div>

              {chat.preview && !activeTab && (
                <ChatPreview
                  authorId={chat.preview.author_id}
                  body={decodeMentions(chat.preview.body, memberById) || "Sent an attachment"}
                  onOpen={() => setPanel("chat")}
                  onDismiss={chat.dismissPreview}
                />
              )}

              {/* Captions get their own strip under the stage, so they never cover anyone's face. */}
              {captionsShown && (
                <CaptionsOverlay speakers={captionFeed.speakers} notice={captionsNotice} className="mt-2" />
              )}

              <div className="pt-3">
                <CallControls
                  snap={snap}
                  room={room}
                  handRaised={handRaised}
                  disabled={connecting}
                  isDesktop={isDesktop}
                  wide={wide}
                  annotating={annotating}
                  onAnnotate={setAnnotating}
                  panelOpen={!!activeTab}
                  onPanel={togglePanel}
                  unread={chat.unread}
                  stageOptions={stageOptions}
                  stage={effectiveStage}
                  onStage={chooseStage}
                  onPresent={
                    (effectiveStage === "whiteboard" || effectiveStage === "board") && snap.participants.length > 1
                      ? bringEveryone
                      : undefined
                  }
                  captions={
                    captionsAvailable ? { on: captionsOn, supported: speechSupported, onToggle: toggleCaptions } : undefined
                  }
                />
              </div>
            </div>

            {activeTab && (
              <aside
                aria-label="Call side panel"
                style={isDesktop ? { width: panelWidth } : undefined}
                className={cn(
                  "flex min-h-0 flex-col overflow-hidden bg-background text-foreground ring-1 ring-white/10",
                  isDesktop
                    ? "relative mr-3 mb-3 shrink-0 rounded-2xl shadow-[0_20px_60px_-20px_rgb(0_0_0/0.8)] animate-in fade-in-0 slide-in-from-right-4 duration-200 motion-reduce:animate-none"
                    : "absolute inset-x-0 bottom-0 z-40 h-[80%] rounded-t-3xl shadow-[0_-20px_60px_-10px_rgb(0_0_0/0.7)] animate-in slide-in-from-bottom-10 duration-300 motion-reduce:animate-none",
                )}
              >
                {isDesktop && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize side panel"
                    aria-valuenow={panelWidth}
                    aria-valuemin={PANEL_MIN}
                    aria-valuemax={PANEL_MAX}
                    tabIndex={0}
                    onPointerDown={onPanelDown}
                    onPointerMove={onPanelMove}
                    onPointerUp={onPanelUp}
                    onPointerCancel={onPanelUp}
                    onKeyDown={onPanelKey}
                    className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize outline-none"
                  >
                    <span className="absolute inset-y-8 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-transparent transition group-hover:bg-white/30 group-focus-visible:bg-white/60" />
                  </div>
                )}

                <div className="relative flex items-center gap-2 px-2 pt-2 pb-2">
                  {!isDesktop && (
                    <span aria-hidden className="absolute top-1.5 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20" />
                  )}
                  <div
                    role="tablist"
                    aria-label="Call panel"
                    className={cn("flex min-w-0 flex-1 items-center gap-0.5 rounded-xl bg-white/[0.05] p-1 ring-1 ring-white/[0.06]", !isDesktop && "mt-2")}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                      const i = tabs.indexOf(activeTab);
                      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
                      setPanel(next);
                      document.getElementById(`${tabsId}-tab-${next}`)?.focus();
                      e.preventDefault();
                    }}
                  >
                    {tabs.map((t) => {
                      const { label, icon: Icon } = TAB_META[t];
                      const on = activeTab === t;
                      // Four tabs don't fit with labels in a narrow panel: inactive ones go icon-only.
                      const showLabel = on || tabs.length < 4 || (isDesktop && panelWidth >= 420);
                      const badge = t === "chat" ? chat.unread : t === "people" ? Object.keys(signals.hands).length : 0;
                      return (
                        <button
                          key={t}
                          id={`${tabsId}-tab-${t}`}
                          type="button"
                          role="tab"
                          aria-selected={on}
                          aria-controls={`${tabsId}-panel`}
                          tabIndex={on ? 0 : -1}
                          aria-label={showLabel ? undefined : label}
                          title={showLabel ? undefined : label}
                          onClick={() => setPanel(t)}
                          className={cn(
                            "relative inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold outline-none transition-[background-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-white/60",
                            on ? "bg-white/[0.12] text-white shadow-sm" : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" aria-hidden />
                          {showLabel && <span className="truncate">{label}</span>}
                          {badge > 0 && (
                            <span
                              className={cn(
                                "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold",
                                t === "chat" ? "bg-rose-500 text-white" : "bg-amber-400 text-amber-950",
                              )}
                            >
                              {badge}
                              <span className="sr-only">{t === "chat" ? " unread" : " raised hands"}</span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanel(null)}
                    aria-label="Close panel"
                    title="Close (Esc)"
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg text-white/55 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60",
                      !isDesktop && "mt-2",
                    )}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>

                <div
                  id={`${tabsId}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${tabsId}-tab-${activeTab}`}
                  className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06]"
                >
                  {activeTab === "people" && (
                    <PeoplePanel
                      channelId={channelId}
                      snap={snap}
                      signals={signals}
                      call={call}
                      invite={invite}
                      canInvite={canInvite && !ended}
                      room={room}
                    />
                  )}
                  {activeTab === "chat" && call?.message_id && (
                    <ChatPanel channelId={channelId} messageId={call.message_id} chat={chat} room={room} typingIds={typingIds} />
                  )}
                  {activeTab === "notes" && call && (
                    <NotesPanel callId={call.id} ended={ended} onSummaryRequested={() => setPanel("transcript")} />
                  )}
                  {activeTab === "transcript" && call && (
                    <CallTranscriptPanel
                      callId={call.id}
                      channelId={channelId}
                      ended={ended}
                      captionsOn={captionsOn}
                      onEnableCaptions={captionsAvailable ? toggleCaptions : undefined}
                    />
                  )}
                </div>
              </aside>
            )}
          </div>

          {windowed && (
            <div
              role="presentation"
              onPointerDown={onResizeDown}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeUp}
              onPointerCancel={onResizeUp}
              onDoubleClick={() => setSize(null)}
              title="Drag to resize · double-click to reset"
              className="absolute right-0 bottom-0 z-40 size-5 cursor-nwse-resize"
            >
              <span aria-hidden className="absolute right-1.5 bottom-1.5 size-2 rounded-br-[3px] border-r-2 border-b-2 border-white/25" />
            </div>
          )}
          {/* Nested in this modal so focus and Esc behave; <HuddleBar> hosts it while we're closed. */}
          <EffectsDialogHost />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Segmented "what's on the stage" control. */
function StageSwitcher({
  options,
  value,
  onChange,
  showLabels,
}: {
  options: StageOption[];
  value: StageMode;
  onChange: (m: StageMode) => void;
  showLabels: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Stage"
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.06] p-1 ring-1 ring-white/10"
    >
      {options.map(({ mode, label, icon: Icon }) => {
        const on = value === mode;
        return (
          <Tip
            key={mode}
            label={`Show ${label.toLowerCase()} on the stage`}
            side="bottom"
            trigger={
              <button
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={label}
                onClick={() => onChange(mode)}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold outline-none transition-[background-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-white/60",
                  on ? "bg-white text-zinc-900 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white",
                  mode === "screen" && !on && "text-emerald-300",
                )}
              />
            }
          >
            <Icon className="size-3.5" aria-hidden />
            {showLabels && <span>{label}</span>}
            {mode === "screen" && !on && (
              <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-400 animate-pulse motion-reduce:animate-none" />
            )}
          </Tip>
        );
      })}
    </div>
  );
}

function ChatPreview({
  authorId,
  body,
  onOpen,
  onDismiss,
}: {
  authorId: string;
  body: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { memberById } = useWorkspace();
  const name = memberById[authorId]?.full_name ?? "Someone";
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute right-3 bottom-[76px] z-30 flex w-[min(340px,calc(100%-24px))] items-start gap-2.5 rounded-2xl bg-zinc-900/90 p-3 text-white shadow-[0_24px_60px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur-xl animate-in fade-in-0 slide-in-from-bottom-3 duration-300 motion-reduce:animate-none"
    >
      <UserAvatar id={authorId} name={name} size="md" />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
        <span className="block text-[13px] font-semibold">{name}</span>
        <span className="line-clamp-2 text-[13px] text-white/75">{body}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-300">
          <MessagesSquare className="size-3" aria-hidden /> Reply in chat
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-white/50 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function HeaderButton({
  label,
  keys,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip
      label={label}
      keys={keys}
      side="bottom"
      trigger={
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 [&_svg]:size-4"
        />
      }
    >
      {children}
    </Tip>
  );
}

export function QualityIcon({ quality, className }: { quality: ConnectionQuality; className?: string }) {
  const map = {
    [ConnectionQuality.Excellent]: { Icon: SignalHigh, cls: "text-emerald-400", label: "Excellent connection" },
    [ConnectionQuality.Good]: { Icon: SignalMedium, cls: "text-emerald-400", label: "Good connection" },
    [ConnectionQuality.Poor]: { Icon: SignalLow, cls: "text-amber-400", label: "Poor connection" },
    [ConnectionQuality.Lost]: { Icon: Signal, cls: "text-red-400", label: "Connection lost" },
    [ConnectionQuality.Unknown]: { Icon: Signal, cls: "text-white/30", label: "Checking connection" },
  } as const;
  const { Icon, cls, label } = map[quality] ?? map[ConnectionQuality.Unknown];
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex", cls, className)}>
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}
