"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { createLocalVideoTrack, type LocalVideoTrack } from "livekit-client";
import { Hash, LoaderCircle, Lock, MessageCircle, Mic, MicOff, Sparkles, Speaker, Video, VideoOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import type { CallKind } from "@/components/calls/types";
import { UserAvatar } from "@/components/chat/user-avatar";
import { applyPreferredEffect } from "@/components/effects/engine";
import { EffectsDialog } from "@/components/effects/effects-panel";
import { closeEffectsPanel } from "@/components/effects/panel-state";
import { effectLabel } from "@/components/effects/presets";
import { getEffectsStore, useEffectsPrefs } from "@/components/effects/store";
import { useWorkspace } from "@/components/workspace/provider";
import { cn } from "@/lib/utils";

import { EffectsButton, RoundButton, Tip } from "./call-window/controls";
import { DeviceSelect, type Kind, speakerSelectionSupported } from "./call-window/device-settings";
import { CALL_THEME_VARS } from "./call-window/theme";
import { VideoView } from "./participant-tile";
import { mediaErrorMessage } from "./room-store";

/**
 * "Ready to join?" — the camera check shown before a video call connects: live preview with my
 * saved effect + mirror, mic level, device pickers, mic/camera toggles and Effects. The chosen
 * devices and on/off state are handed to the connect flow as a `MediaChoice`.
 */

/** What the user picked in the pre-join check (or defaults when it's skipped). */
export type MediaChoice = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
  speakerDeviceId?: string;
};

export type PreJoinMode = "start" | "accept" | "join";

export type PreJoinRequest = {
  id: number;
  /** "" when accepting a call whose channel we don't know yet. */
  channelId: string;
  mode: PreJoinMode;
  callKind: CallKind;
  resolve: (choice: MediaChoice | null) => void;
};

export const DEFAULT_MEDIA: MediaChoice = { micEnabled: true, cameraEnabled: true };

// --- "Don't show again" preference (per device) ---

const SKIP_KEY = "worklio.preJoin.skip";
const skipListeners = new Set<() => void>();

function readSkip(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export const preJoinSkip = {
  subscribe(fn: () => void) {
    skipListeners.add(fn);
    const onStorage = (e: StorageEvent) => {
      if (e.key === SKIP_KEY) fn();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      skipListeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot: readSkip,
  getServerSnapshot: () => false,
  set(skip: boolean) {
    try {
      if (skip) localStorage.setItem(SKIP_KEY, "1");
      else localStorage.removeItem(SKIP_KEY);
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    skipListeners.forEach((fn) => fn());
  },
};

// --- Whether the check is on screen (the call's own Effects host stands down meanwhile) ---

let openCount = 0;
const openListeners = new Set<() => void>();

function bumpOpen(delta: number) {
  openCount = Math.max(0, openCount + delta);
  openListeners.forEach((fn) => fn());
}

function subscribeOpen(fn: () => void) {
  openListeners.add(fn);
  return () => {
    openListeners.delete(fn);
  };
}

export function usePreJoinOpen(): boolean {
  return useSyncExternalStore(
    subscribeOpen,
    () => openCount > 0,
    () => false,
  );
}

// --- Dialog ---

export function PreJoinDialog({ request }: { request: PreJoinRequest | null }) {
  // Keep the last request on screen while the dialog animates out (its media is already stopped).
  const [shown, setShown] = useState(request);
  if (request && request !== shown) setShown(request);
  return (
    <DialogPrimitive.Root
      open={!!request}
      onOpenChange={(next) => {
        if (!next) request?.resolve(null);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-md duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          style={CALL_THEME_VARS}
          // Keys typed here must not reach the call window's shortcuts (M, V, S, …).
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          className={cn(
            "dark fixed z-50 flex flex-col overflow-hidden bg-zinc-900/95 text-zinc-50 outline-none ring-1 ring-white/10 backdrop-blur-2xl",
            "shadow-[0_40px_120px_-20px_rgb(0_0_0/0.85)] duration-200 motion-reduce:animate-none",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            // phone: bottom sheet · desktop: centred card
            "inset-x-0 bottom-0 max-h-[94dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom-8 data-closed:slide-out-to-bottom-8",
            "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(760px,calc(100dvh-2.5rem))] sm:w-[min(40rem,calc(100vw-2.5rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:pb-0",
            "sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-[0.97] sm:data-closed:slide-out-to-bottom-0 sm:data-closed:zoom-out-[0.97]",
          )}
        >
          {shown && <PreJoinBody key={shown.id} request={shown} active={request === shown} />}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type CamState = { track: LocalVideoTrack | null; error: string | null; deviceId: string | null };
type MicState = { error: string | null; deviceId: string | null };
type DeviceLists = Record<Kind, MediaDeviceInfo[]>;
const NO_DEVICES: DeviceLists = { audioinput: [], videoinput: [], audiooutput: [] };
const PREVIEW_OPTS = { resolution: { width: 1280, height: 720, frameRate: 30 } };

function PreJoinBody({ request, active }: { request: PreJoinRequest; active: boolean }) {
  const { me, channels, channelLabel } = useWorkspace();
  const prefs = useEffectsPrefs();
  const userId = me?.id;
  const dontShowId = useId();

  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camChoice, setCamChoice] = useState<string | undefined>(undefined);
  const [micChoice, setMicChoice] = useState<string | undefined>(undefined);
  const [speakerChoice, setSpeakerChoice] = useState<string | undefined>(undefined);
  const [dontShow, setDontShow] = useState(false);
  const [cam, setCam] = useState<CamState>({ track: null, error: null, deviceId: null });
  const [mic, setMic] = useState<MicState>({ error: null, deviceId: null });
  const [deviceRefresh, setDeviceRefresh] = useState(0);
  const devices = useDeviceLists(deviceRefresh);
  const speaker = speakerSelectionSupported();
  const meterRef = useRef<HTMLSpanElement>(null);

  // Tell the call's own Effects host to stand down while this check (and its panel) is up.
  useEffect(() => {
    if (!active) return;
    bumpOpen(1);
    return () => {
      bumpOpen(-1);
      closeEffectsPanel();
    };
  }, [active]);

  // --- Camera preview (with my saved effect) ---
  useEffect(() => {
    if (!camOn || !active) return;
    let alive = true;
    let created: LocalVideoTrack | null = null;
    void (async () => {
      try {
        const t = await createLocalVideoTrack({ ...PREVIEW_OPTS, ...(camChoice ? { deviceId: camChoice } : null) });
        if (!alive) {
          t.stop();
          return;
        }
        created = t;
        setCam({ track: t, error: null, deviceId: t.mediaStreamTrack?.getSettings().deviceId ?? camChoice ?? null });
        setDeviceRefresh((n) => n + 1); // labels are only readable once permission is granted
        if (userId) await applyPreferredEffect(t, userId).catch(() => {});
      } catch (err) {
        if (alive) setCam({ track: null, error: mediaErrorMessage(err, "camera"), deviceId: null });
      }
    })();
    return () => {
      alive = false;
      created?.stop();
    };
  }, [camOn, active, camChoice, userId]);

  const track = active && camOn && cam.track && !cam.track.isStopped ? cam.track : null;

  // Follow effect changes made in the Effects panel.
  useEffect(() => {
    if (!track || !userId) return;
    return getEffectsStore(userId).subscribe(() => {
      void applyPreferredEffect(track, userId).catch(() => {});
    });
  }, [track, userId]);

  // --- Microphone level ---
  useEffect(() => {
    if (!micOn || !active) return;
    const el = meterRef.current;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) return;
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let alive = true;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    void (async () => {
      try {
        const s = await md.getUserMedia({
          audio: { ...(micChoice ? { deviceId: { exact: micChoice } } : null), echoCancellation: true, noiseSuppression: true },
        });
        if (!alive) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const at = s.getAudioTracks()[0];
        setMic({ error: null, deviceId: at?.getSettings().deviceId ?? micChoice ?? null });
        setDeviceRefresh((n) => n + 1);
        if (!AudioCtx || !el) return;
        ctx = new AudioCtx();
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
        const analyser = Object.assign(ctx.createAnalyser(), { fftSize: 512, smoothingTimeConstant: 0.3 });
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let level = 0;
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const target = Math.min(1, Math.sqrt(sum / buf.length) * 5);
          level = target > level ? target : level * 0.86 + target * 0.14;
          el.style.transform = `scaleX(${level.toFixed(3)})`;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (alive) setMic({ error: mediaErrorMessage(err, "microphone"), deviceId: null });
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      if (el) el.style.transform = "scaleX(0)";
    };
  }, [micOn, active, micChoice]);

  // --- Labels ---
  const channel = request.channelId ? channels.find((c) => c.id === request.channelId) : undefined;
  const where = channel ? (channel.kind === "dm" ? channelLabel(channel) : `#${channel.name}`) : null;
  const WhereIcon = channel?.kind === "dm" ? MessageCircle : channel?.kind === "private" ? Lock : Hash;
  const kindLabel = request.callKind === "video" ? "Video call" : "Huddle";
  const joinLabel = request.mode === "start" ? "Start call" : "Join now";
  const effectOn = prefs.effect !== "none";

  const pick = (kind: Kind, id: string) => {
    if (kind === "videoinput") setCamChoice(id);
    else if (kind === "audioinput") setMicChoice(id);
    else setSpeakerChoice(id);
  };

  const join = () => {
    if (!active) return;
    if (dontShow) preJoinSkip.set(true);
    request.resolve({
      micEnabled: micOn,
      cameraEnabled: camOn,
      audioDeviceId: micChoice ?? mic.deviceId ?? undefined,
      videoDeviceId: camChoice ?? cam.deviceId ?? undefined,
      speakerDeviceId: speakerChoice,
    });
  };

  const camLoading = active && camOn && !track && !cam.error;
  const joinRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-medium text-white/70 ring-1 ring-white/10">
              <Video className="size-3.5 shrink-0 text-emerald-300" aria-hidden />
              <span className="shrink-0">{kindLabel}</span>
              {where && (
                <>
                  <span aria-hidden className="text-white/30">
                    ·
                  </span>
                  <WhereIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{where.replace(/^#/, "")}</span>
                </>
              )}
            </p>
            <DialogPrimitive.Title className="mt-2.5 text-xl font-semibold tracking-tight sm:text-2xl">
              Ready to join?
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-sm text-white/55">
              Check your camera and mic before anyone sees or hears you.
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close
            aria-label="Cancel"
            className="-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-white/60 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="size-4" aria-hidden />
          </DialogPrimitive.Close>
        </div>

        {/* Preview */}
        <div className="px-5 sm:px-6">
          <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-white/10">
            {track ? (
              <VideoView track={track} mirror={prefs.mirror} className="animate-in fade-in-0 duration-300 motion-reduce:animate-none" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(80%_70%_at_50%_40%,rgb(255_255_255/0.06),transparent_70%)] px-6 text-center">
                {camLoading ? (
                  <>
                    <LoaderCircle className="size-6 animate-spin text-white/60 motion-reduce:animate-none" aria-hidden />
                    <p className="text-sm text-white/60">Starting your camera…</p>
                  </>
                ) : !active ? null : (
                  <>
                    {me && (
                      <UserAvatar id={me.id} name={me.full_name} size="xl" className="[&>span]:rounded-[18px] [&>span]:shadow-lg" />
                    )}
                    <p className="max-w-sm text-sm text-white/65">{camOn ? cam.error : "Your camera is off"}</p>
                  </>
                )}
              </div>
            )}

            {track && effectOn && (
              <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11.5px] font-medium text-white/90 ring-1 ring-white/10 backdrop-blur">
                <Sparkles className="size-3 text-fuchsia-300" aria-hidden />
                {effectLabel(prefs.effect)}
              </span>
            )}
            {!micOn && (
              <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[11.5px] font-semibold text-white">
                <MicOff className="size-3" aria-hidden />
                Muted
              </span>
            )}

            {/* Toggles over the preview */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2.5 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8 pb-3">
              <Tip
                label={micOn ? "Mute microphone" : "Unmute microphone"}
                trigger={
                  <RoundButton
                    tone="stage"
                    state={micOn ? "default" : "off"}
                    label={micOn ? "Mute microphone" : "Unmute microphone"}
                    aria-pressed={micOn}
                    onClick={() => setMicOn((v) => !v)}
                  />
                }
              >
                {micOn ? <Mic aria-hidden /> : <MicOff aria-hidden />}
              </Tip>
              <Tip
                label={camOn ? "Turn off camera" : "Turn on camera"}
                trigger={
                  <RoundButton
                    tone="stage"
                    state={camOn ? "default" : "off"}
                    label={camOn ? "Turn off camera" : "Turn on camera"}
                    aria-pressed={camOn}
                    onClick={() => setCamOn((v) => !v)}
                  />
                }
              >
                {camOn ? <Video aria-hidden /> : <VideoOff aria-hidden />}
              </Tip>
              <EffectsButton tone="stage" />
            </div>
          </div>

          {/* Mic level */}
          <div className="mt-3 flex items-center gap-2.5" aria-live="polite">
            {micOn ? <Mic className="size-4 shrink-0 text-white/60" aria-hidden /> : <MicOff className="size-4 shrink-0 text-red-300" aria-hidden />}
            {micOn && !mic.error ? (
              <>
                <span
                  aria-hidden
                  className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.08] [mask-image:repeating-linear-gradient(90deg,#000_0_7px,transparent_7px_10px)]"
                >
                  <span
                    ref={meterRef}
                    className="absolute inset-0 origin-left bg-gradient-to-r from-emerald-500 via-emerald-400 to-lime-300"
                    style={{ transform: "scaleX(0)" }}
                  />
                </span>
                <span className="shrink-0 text-xs text-white/50">Say something to test</span>
              </>
            ) : (
              <span className="text-xs text-white/55">{micOn ? mic.error : "You'll join muted"}</span>
            )}
          </div>

          {/* Devices */}
          <div className={cn("mt-4 grid gap-3", speaker ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
            <DeviceSelect
              label="Camera"
              icon={Video}
              kind="videoinput"
              list={devices.videoinput}
              value={camChoice ?? cam.deviceId ?? undefined}
              onPick={pick}
            />
            <DeviceSelect
              label="Microphone"
              icon={Mic}
              kind="audioinput"
              list={devices.audioinput}
              value={micChoice ?? mic.deviceId ?? undefined}
              onPick={pick}
            />
            {speaker && (
              <DeviceSelect
                label="Speaker"
                icon={Speaker}
                kind="audiooutput"
                list={devices.audiooutput}
                value={speakerChoice}
                onPick={pick}
              />
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <input
            id={dontShowId}
            type="checkbox"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-emerald-500"
          />
          <label htmlFor={dontShowId} className="min-w-0 text-sm text-white/75">
            Don&apos;t show this again
            <span className="block text-xs text-white/45">Turn it back on in call settings.</span>
          </label>
        </div>
        <div className="flex gap-2">
          <DialogPrimitive.Close className="inline-flex h-10 flex-1 items-center justify-center rounded-full px-4 text-sm font-medium text-white/80 ring-1 ring-white/15 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 sm:flex-none">
            Cancel
          </DialogPrimitive.Close>
          <button
            ref={joinRef}
            type="button"
            onClick={join}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-emerald-500 px-5 text-sm font-semibold text-emerald-950 shadow-[0_8px_24px_-8px_rgb(16_185_129/0.7)] outline-none transition hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 sm:flex-none"
          >
            {camOn ? <Video className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />}
            {joinLabel}
          </button>
        </div>
      </div>

      <AutoFocus target={joinRef} />
      {/* The Effects panel, previewing on this very track. Nested so Esc closes it first. */}
      <EffectsDialog room={null} cameraTrack={track} />
    </>
  );
}

/** Focuses the primary action once the dialog has opened. */
function AutoFocus({ target }: { target: React.RefObject<HTMLButtonElement | null> }) {
  useEffect(() => {
    const id = window.setTimeout(() => target.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(id);
  }, [target]);
  return null;
}

/** Camera / mic / speaker lists; refreshed on plug/unplug and whenever `refresh` changes. */
function useDeviceLists(refresh: number): DeviceLists {
  const [lists, setLists] = useState<DeviceLists>(NO_DEVICES);
  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.enumerateDevices) return;
    let live = true;
    const load = async () => {
      try {
        const all = await md.enumerateDevices();
        if (!live) return;
        setLists({
          audioinput: all.filter((d) => d.kind === "audioinput"),
          videoinput: all.filter((d) => d.kind === "videoinput"),
          audiooutput: all.filter((d) => d.kind === "audiooutput"),
        });
      } catch {
        // insecure context: leave the lists empty
      }
    };
    void load();
    md.addEventListener?.("devicechange", load);
    return () => {
      live = false;
      md.removeEventListener?.("devicechange", load);
    };
  }, [refresh]);
  return lists;
}
