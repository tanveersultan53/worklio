"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { createLocalVideoTrack, type LocalVideoTrack, type Room, TrackEvent } from "livekit-client";
import { Ban, Check, ImagePlus, Info, LoaderCircle, Sparkles, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { VideoView } from "@/components/huddle/participant-tile";
import { mediaErrorMessage } from "@/components/huddle/room-store";
import { CALL_THEME_VARS } from "@/components/huddle/call-window/theme";
import { cn } from "@/lib/utils";

import { applyPreferredEffect, effectsSupported, forgetBackground, preloadBackground } from "./engine";
import { useEffectsPanelOpen, setEffectsPanelOpen } from "./panel-state";
import {
  BACKGROUND_EFFECTS,
  BLUR_EFFECTS,
  CUSTOM_IMAGE_TYPES,
  type EffectDef,
  type EffectId,
  effectLabel,
  NONE_EFFECT,
} from "./presets";
import { useEffectsPrefs } from "./store";
import { STUDIO_LEVELS, type StudioLevel } from "./studio";

/** Approximate "person" cut-out used by the live thumbnails (the big preview shows the real result). */
const PERSON_MASK = "radial-gradient(ellipse 30% 46% at 50% 68%, #000 64%, transparent 100%)";
/** Thumbnail blur that reads like the real radius at full size. */
const THUMB_BLUR: Record<number, string> = { 10: "2px", 25: "4.5px" };
const PREVIEW_OPTS = { resolution: { width: 960, height: 540, frameRate: 24 } };

/**
 * The camera Effects panel: live preview, blur, virtual backgrounds, your own image and
 * "mirror my video". Render it once per screen (it opens via `openEffectsPanel()`).
 * `cameraTrack` is my published, unmuted camera, or null (the panel then opens a private preview).
 */
export function EffectsDialog({ room, cameraTrack }: { room: Room | null; cameraTrack: LocalVideoTrack | null }) {
  const open = useEffectsPanelOpen();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => setEffectsPanelOpen(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-zinc-950/55 backdrop-blur-sm duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          style={CALL_THEME_VARS}
          // Keys typed here must not reach the call window's shortcuts (M, V, S, …).
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
          className={cn(
            "dark fixed z-[60] flex flex-col overflow-hidden bg-zinc-900/95 text-zinc-50 outline-none ring-1 ring-white/10 backdrop-blur-2xl",
            "shadow-[0_40px_120px_-20px_rgb(0_0_0/0.85)] duration-200 motion-reduce:animate-none",
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            // phone: bottom sheet · desktop: centred card
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom-8 data-closed:slide-out-to-bottom-8",
            "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[min(720px,calc(100dvh-2.5rem))] sm:w-[min(52rem,calc(100vw-2.5rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[22px] sm:pb-0",
            "sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-[0.97] sm:data-closed:slide-out-to-bottom-0 sm:data-closed:zoom-out-[0.97]",
          )}
        >
          <EffectsBody room={room} cameraTrack={cameraTrack} active={open} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function EffectsBody({ room, cameraTrack, active }: { room: Room | null; cameraTrack: LocalVideoTrack | null; active: boolean }) {
  const prefs = useEffectsPrefs();
  const supported = useEffectsSupported();
  const preview = usePreviewTrack(room, active && !cameraTrack, prefs.userId);
  const track = cameraTrack ?? preview.track;
  const raw = useRawStream(track);
  const [pending, setPending] = useState<EffectId | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const applyNow = (id: EffectId) => {
    const t = cameraTrack ?? preview.track;
    if (!t) return;
    setPending(id);
    applyPreferredEffect(t, prefs.userId)
      .then(() => setPending((p) => (p === id ? null : p)))
      .catch(() => {
        setPending(null);
        setNotice("That effect couldn't be applied. Try another one, or reload the page.");
      });
  };

  const chooseStudio = (level: StudioLevel) => {
    setNotice(null);
    prefs.setStudio(level);
    const t = cameraTrack ?? preview.track;
    if (!t) return;
    applyPreferredEffect(t, prefs.userId).catch(() =>
      setNotice("The Studio look couldn't be applied in this browser. Your camera still works without it."),
    );
  };

  const choose = (id: EffectId) => {
    setNotice(null);
    prefs.setEffect(id);
    applyNow(id);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const previous = prefs.customUrl;
    const error = await prefs.setCustomImage(file);
    if (error) {
      setNotice(error);
      return;
    }
    setNotice(null);
    if (previous) forgetBackground(previous);
    applyNow("custom");
  };

  const removeCustom = () => {
    const previous = prefs.customUrl;
    prefs.clearCustomImage();
    if (previous) forgetBackground(previous);
    if (prefs.effect === "custom") applyNow("none");
  };

  const effectsOff = supported === false;
  const mirror = prefs.mirror;
  const previewing = !cameraTrack;

  return (
    <>
      <header className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-3 sm:px-5">
        <span aria-hidden className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/30 to-violet-500/20 text-fuchsia-200 ring-1 ring-white/10">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <DialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">Backgrounds &amp; effects</DialogPrimitive.Title>
          <DialogPrimitive.Description className="truncate text-xs text-white/55">
            {previewing ? "Your camera is off. Only you can see this preview." : "Changes apply to your camera right away."}
          </DialogPrimitive.Description>
        </div>
        <DialogPrimitive.Close
          aria-label="Close effects"
          className="flex size-8 items-center justify-center rounded-full text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4 sm:p-5 md:flex-row md:gap-5">
        {/* Preview */}
        <div className="flex shrink-0 flex-col gap-3 md:w-[46%]">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-zinc-950 ring-1 ring-white/10">
            {track ? (
              <VideoView track={track} mirror={mirror} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-white/55">
                {preview.error ? (
                  <>
                    <TriangleAlert className="size-5 text-amber-300" aria-hidden />
                    <span>{preview.error}</span>
                  </>
                ) : (
                  <>
                    <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
                    <span>Starting camera preview…</span>
                  </>
                )}
              </div>
            )}
            {pending && track && (
              <span className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md animate-in fade-in-0 duration-150">
                <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                Applying {effectLabel(pending).toLowerCase()}…
              </span>
            )}
            <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-semibold text-white/85 backdrop-blur-md">
              {effectLabel(prefs.effect)}
            </span>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.07]">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">Mirror my video</span>
              <span className="block text-[11.5px] text-white/50">Only changes your own view. Others always see you unmirrored.</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={mirror}
              onChange={(e) => prefs.setMirror(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="relative h-5 w-9 shrink-0 rounded-full bg-white/15 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300/60 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4 motion-reduce:after:transition-none"
            />
          </label>

          {/* Studio look: on-device light, noise, colour and clarity enhancement. */}
          <div className="rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.07]">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Sparkles className="size-3.5 text-fuchsia-300" aria-hidden />
                  Studio look
                </span>
                <span className="block text-[11.5px] text-white/50">
                  Brightens low light, reduces grain, balances colour and sharpens detail. Runs on your device.
                </span>
              </span>
            </div>
            <div role="radiogroup" aria-label="Studio look" className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-black/30 p-1">
              {STUDIO_LEVELS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.studio === l.id}
                  disabled={effectsOff}
                  onClick={() => chooseStudio(l.id)}
                  className={cn(
                    "rounded-md py-1.5 text-[12.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40",
                    prefs.studio === l.id ? "bg-white text-zinc-900 shadow-sm" : "text-white/70 hover:bg-white/10 hover:text-white",
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {effectsOff && (
            <p className="flex gap-2 rounded-xl bg-amber-400/10 px-3 py-2.5 text-[12px] leading-snug text-amber-100 ring-1 ring-amber-300/20">
              <Info className="mt-px size-4 shrink-0 text-amber-300" aria-hidden />
              <span>
                Background effects aren&apos;t available in this browser (they need WebGL2 and modern video APIs). Try the
                latest Chrome, Edge or Firefox on a computer.
              </span>
            </p>
          )}
          {notice && (
            <p role="alert" className="flex gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-[12px] leading-snug text-red-100 ring-1 ring-red-400/20">
              <TriangleAlert className="mt-px size-4 shrink-0 text-red-300" aria-hidden />
              <span>{notice}</span>
            </p>
          )}
        </div>

        {/* Picker */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Section title="Blur">
            {[NONE_EFFECT, ...BLUR_EFFECTS].map((def) => (
              <EffectTile
                key={def.id}
                def={def}
                stream={raw}
                mirror={mirror}
                selected={prefs.effect === def.id}
                pending={pending === def.id}
                disabled={def.kind !== "none" && effectsOff}
                onPick={() => choose(def.id)}
              />
            ))}
          </Section>

          <Section title="Backgrounds">
            {BACKGROUND_EFFECTS.map((def) => (
              <EffectTile
                key={def.id}
                def={def}
                stream={raw}
                mirror={mirror}
                selected={prefs.effect === def.id}
                pending={pending === def.id}
                disabled={effectsOff}
                onPick={() => choose(def.id)}
              />
            ))}
            {prefs.customUrl && (
              <div className="relative">
                <EffectTile
                  def={{ id: "custom", label: "Your image", kind: "image", src: prefs.customUrl }}
                  stream={raw}
                  mirror={mirror}
                  selected={prefs.effect === "custom"}
                  pending={pending === "custom"}
                  disabled={effectsOff}
                  onPick={() => choose("custom")}
                />
                <button
                  type="button"
                  onClick={removeCustom}
                  aria-label="Remove your uploaded background"
                  title="Remove"
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/65 text-white/85 outline-none backdrop-blur-md transition hover:bg-red-600 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={effectsOff}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                if (!effectsOff) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!effectsOff) void upload(e.dataTransfer.files[0]);
              }}
              className="group flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-1 text-center text-[11px] font-medium text-white/70 outline-none transition hover:border-white/40 hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-40"
            >
              <ImagePlus className="size-4 transition-transform group-hover:scale-110 motion-reduce:transition-none" aria-hidden />
              <span>{prefs.customUrl ? "Replace image…" : "Upload image…"}</span>
            </button>
          </Section>
          <input
            ref={fileRef}
            type="file"
            accept={CUSTOM_IMAGE_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void upload(file);
            }}
          />
        </div>
      </div>

      <footer className="flex items-center gap-3 border-t border-white/[0.07] px-4 py-3 sm:px-5">
        <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-white/45">
          Effects run on this device. Uploaded images stay in this browser (JPG, PNG or WebP, up to 8 MB).
        </p>
        <DialogPrimitive.Close className="inline-flex h-9 shrink-0 items-center rounded-full bg-white px-4 text-sm font-semibold text-zinc-900 outline-none transition hover:bg-white/85 focus-visible:ring-2 focus-visible:ring-white/60 active:scale-95 motion-reduce:active:scale-100">
          Done
        </DialogPrimitive.Close>
      </footer>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-bold tracking-wide text-white/50 uppercase">{title}</h3>
      <div role="group" aria-label={title} className="grid grid-cols-3 gap-2 min-[520px]:grid-cols-4 md:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

function EffectTile({
  def,
  stream,
  mirror,
  selected,
  pending,
  disabled,
  onPick,
}: {
  def: EffectDef;
  stream: MediaStream | null;
  mirror: boolean;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const flip = mirror ? "-scale-x-100" : undefined;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={def.kind === "none" ? "No effect" : def.label}
      onPointerEnter={def.kind === "image" ? () => preloadBackground(def.src) : undefined}
      onFocus={def.kind === "image" ? () => preloadBackground(def.src) : undefined}
      className={cn(
        "group relative block aspect-video w-full overflow-hidden rounded-xl bg-zinc-800 text-left outline-none ring-1 transition-[box-shadow,transform] duration-150",
        "hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-white/70 active:translate-y-0 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        selected ? "ring-2 ring-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/0.18)]" : "ring-white/10 hover:ring-white/30",
      )}
    >
      {/* Background layer */}
      {def.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- local/object-URL thumbnails
        <img src={def.src} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
      ) : stream ? (
        <StreamVideo
          stream={stream}
          className={cn("absolute inset-0 size-full object-cover", flip)}
          style={def.kind === "blur" ? { filter: `blur(${THUMB_BLUR[def.radius] ?? "3px"})`, transform: "scale(1.15)" } : undefined}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0",
            def.kind === "blur"
              ? "bg-[radial-gradient(circle_at_30%_35%,rgb(244_114_182/0.45),transparent_55%),radial-gradient(circle_at_75%_70%,rgb(129_140_248/0.5),transparent_55%)] blur-[3px]"
              : "bg-zinc-800",
          )}
        />
      )}

      {/* Me, sharp, in front (approximate cut-out) */}
      {stream && def.kind !== "none" && (
        <StreamVideo
          stream={stream}
          className={cn("absolute inset-0 size-full object-cover", flip)}
          style={{ maskImage: PERSON_MASK, WebkitMaskImage: PERSON_MASK }}
        />
      )}

      {def.kind === "none" && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/25">
          <Ban className="size-5 text-white/85 drop-shadow" />
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-3 pb-1 text-[10.5px] font-semibold text-white">
        {def.kind === "none" ? "None" : def.label}
      </span>

      {selected && !pending && (
        <span aria-hidden className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-emerald-400 text-emerald-950 shadow animate-in zoom-in-50 duration-150 motion-reduce:animate-none">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {pending && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/40">
          <LoaderCircle className="size-5 animate-spin text-white motion-reduce:animate-none" />
        </span>
      )}
    </button>
  );
}

/** A muted <video> playing a raw MediaStream (for thumbnails). */
function StreamVideo({ stream, className, style }: { stream: MediaStream; className?: string; style?: React.CSSProperties }) {
  const ref = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== stream) el.srcObject = stream;
    },
    [stream],
  );
  return <video ref={ref} autoPlay muted playsInline aria-hidden className={className} style={style} />;
}

// --- Hooks ---

function useEffectsSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void effectsSupported().then((ok) => {
      if (alive) setSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return supported;
}

/** A private camera preview (with my effect) while the published camera is off. */
function usePreviewTrack(room: Room | null, needed: boolean, userId: string) {
  const [state, setState] = useState<{ track: LocalVideoTrack | null; error: string | null }>({ track: null, error: null });
  useEffect(() => {
    if (!needed) return;
    let alive = true;
    let created: LocalVideoTrack | null = null;
    void (async () => {
      try {
        const deviceId = room?.getActiveDevice("videoinput");
        const t = await createLocalVideoTrack({ ...PREVIEW_OPTS, ...(deviceId ? { deviceId } : null) });
        if (!alive) {
          t.stop();
          return;
        }
        created = t;
        setState({ track: t, error: null });
        await applyPreferredEffect(t, userId).catch(() => {});
      } catch (err) {
        if (alive) setState({ track: null, error: mediaErrorMessage(err, "camera") });
      }
    })();
    return () => {
      alive = false;
      created?.stop();
    };
  }, [needed, room, userId]);
  const track = needed && state.track && !state.track.isStopped ? state.track : null;
  return { track, error: needed && !track ? state.error : null };
}

type Emitter = { on(e: string, fn: () => void): unknown; off(e: string, fn: () => void): unknown };
const RAW_EVENTS = [TrackEvent.Restarted, TrackEvent.TrackProcessorUpdate, TrackEvent.Muted, TrackEvent.Unmuted, TrackEvent.Ended];

function rawSource(track: LocalVideoTrack): MediaStreamTrack | null {
  const source = (track.getProcessor() as { source?: MediaStreamTrack } | undefined)?.source;
  const t = source ?? track.mediaStreamTrack;
  return t && t.readyState === "live" ? t : null;
}

/** The camera's unprocessed frames as a MediaStream (for thumbnails), or null. */
function useRawStream(track: LocalVideoTrack | null): MediaStream | null {
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!track) return () => {};
      const em = track as unknown as Emitter;
      RAW_EVENTS.forEach((e) => em.on(e, fn));
      return () => RAW_EVENTS.forEach((e) => em.off(e, fn));
    },
    [track],
  );
  const getSnapshot = useCallback(() => (track ? rawSource(track) : null), [track]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return useMemo(() => (raw ? new MediaStream([raw]) : null), [raw]);
}
