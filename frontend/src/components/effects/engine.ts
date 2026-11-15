"use client";

import {
  createLocalVideoTrack,
  type LocalVideoTrack,
  MediaDeviceFailure,
  type Room,
  Track,
  type TrackProcessor,
  type VideoCaptureOptions,
} from "livekit-client";

import { toast } from "@/lib/toast";

import { effectDef } from "./presets";
import { type EffectsSnapshot, getEffectsStore } from "./store";
import { StudioEnhancer, type StudioLevel } from "./studio";

/**
 * Applies background effects (blur / virtual background) to a LiveKit camera track with
 * @livekit/track-processors. The library (and MediaPipe's segmenter) is only loaded the first
 * time an effect is actually needed.
 */

type Processors = typeof import("@livekit/track-processors");
type BackgroundMode =
  | { mode: "background-blur"; blurRadius: number }
  | { mode: "virtual-background"; imagePath: string }
  | { mode: "disabled" };
/** Background effect plus the Studio look, applied together in one processor. */
type SwitchOptions = BackgroundMode & { studio: StudioLevel };

/** What a track should look like: `key` identifies it, `options` is null for "no effect". */
export type EffectTarget = { key: string; options: SwitchOptions | null };

const NO_EFFECT: EffectTarget = { key: "none", options: null };
const PROCESSOR_NAME = "worklio-background";

let modulePromise: Promise<Processors> | null = null;
let supportedCache: boolean | null = null;

function loadProcessors(): Promise<Processors> {
  modulePromise ??= import("@livekit/track-processors").catch((err) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

/** Whether this browser can run background effects (WebGL2 + insertable streams or canvas capture). */
export async function effectsSupported(): Promise<boolean> {
  if (supportedCache !== null) return supportedCache;
  if (typeof window === "undefined") return false;
  try {
    const mod = await loadProcessors();
    supportedCache = mod.supportsBackgroundProcessors();
  } catch {
    supportedCache = false;
  }
  return supportedCache;
}

// --- Background images: rasterised once to a 1280×720 PNG (SVGs and huge photos alike) ---

const OUT_W = 1280;
const OUT_H = 720;
const rasterCache = new Map<string, Promise<string>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

async function rasterize(src: string): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || OUT_W;
  const h = img.naturalHeight || OUT_H;
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W;
  canvas.height = OUT_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src;
  // "cover" crop to 16:9
  const scale = Math.max(OUT_W / w, OUT_H / h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  return blob ? URL.createObjectURL(blob) : src;
}

function rasterized(src: string): Promise<string> {
  let p = rasterCache.get(src);
  if (!p) {
    p = rasterize(src).catch((err) => {
      rasterCache.delete(src);
      throw err;
    });
    rasterCache.set(src, p);
  }
  return p;
}

/** Drops the cached raster of an uploaded image that's been replaced/removed. */
export function forgetBackground(src: string) {
  const p = rasterCache.get(src);
  rasterCache.delete(src);
  void p?.then((url) => url !== src && URL.revokeObjectURL(url)).catch(() => {});
}

/** Warms the raster cache (e.g. on hover) so switching feels instant. */
export function preloadBackground(src: string) {
  void rasterized(src).catch(() => {});
}

/** Whether these preferences need the video pipeline at all (a background effect or the Studio look). */
export function wantsProcessing(prefs: Pick<EffectsSnapshot, "effect" | "studio">): boolean {
  return prefs.effect !== "none" || (prefs.studio ?? "off") !== "off";
}

async function resolveBackground(prefs: Pick<EffectsSnapshot, "effect" | "customUrl">): Promise<{ key: string; mode: BackgroundMode }> {
  if (prefs.effect === "custom") {
    if (!prefs.customUrl) return { key: "none", mode: { mode: "disabled" } };
    return { key: `custom:${prefs.customUrl}`, mode: { mode: "virtual-background", imagePath: await rasterized(prefs.customUrl) } };
  }
  const def = effectDef(prefs.effect);
  if (!def || def.kind === "none") return { key: "none", mode: { mode: "disabled" } };
  if (def.kind === "blur") return { key: `blur:${def.radius}`, mode: { mode: "background-blur", blurRadius: def.radius } };
  return { key: `img:${def.src}`, mode: { mode: "virtual-background", imagePath: await rasterized(def.src) } };
}

/** Resolves preferences to a concrete processor target. */
export async function resolveTarget(prefs: Pick<EffectsSnapshot, "effect" | "customUrl" | "studio">): Promise<EffectTarget> {
  const bg = await resolveBackground(prefs);
  const studio = prefs.studio ?? "off";
  if (bg.key === "none" && studio === "off") return NO_EFFECT;
  return { key: `${bg.key}|studio:${studio}`, options: { ...bg.mode, studio } };
}

/** Options for LiveKit's background transformer from our switch options. */
function backgroundOptions(o: SwitchOptions) {
  if (o.mode === "background-blur") return { imagePath: undefined, blurRadius: o.blurRadius, backgroundDisabled: false };
  if (o.mode === "virtual-background") return { imagePath: o.imagePath, blurRadius: undefined, backgroundDisabled: false };
  return { imagePath: undefined, blurRadius: undefined, backgroundDisabled: true };
}

/**
 * One processor for both: each frame goes through the Studio enhancer (GPU) first, then LiveKit's
 * background transformer (segmentation + blur / replace, or a pass-through when disabled).
 */
function createProcessor(mod: Processors, options: SwitchOptions) {
  class StudioBackgroundTransformer extends mod.BackgroundTransformer {
    enhancer = new StudioEnhancer(options.studio);

    async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
      if (this.enhancer.active && frame instanceof VideoFrame && frame.codedWidth > 0) {
        const enhanced = this.enhancer.process(frame);
        if (enhanced) {
          frame.close();
          return super.transform(enhanced, controller);
        }
      }
      return super.transform(frame, controller);
    }

    async destroy(opts?: Parameters<InstanceType<Processors["BackgroundTransformer"]>["destroy"]>[0]) {
      this.enhancer.destroy();
      return super.destroy(opts);
    }
  }

  class StudioProcessor extends mod.ProcessorWrapper<Record<string, unknown>, StudioBackgroundTransformer> {
    async switchTo(next: SwitchOptions) {
      this.transformer.enhancer.setLevel(next.studio);
      await this.updateTransformerOptions(backgroundOptions(next));
    }
  }

  return new StudioProcessor(new StudioBackgroundTransformer(backgroundOptions(options)), PROCESSOR_NAME, { maxFps: 30 });
}

// --- Applying to a track (serialised per track, idempotent) ---

const processorKeys = new WeakMap<object, string>();
const chains = new WeakMap<LocalVideoTrack, Promise<unknown>>();

type Switchable = TrackProcessor<Track.Kind.Video> & { switchTo?: (o: SwitchOptions) => Promise<void> };

async function applyNow(track: LocalVideoTrack, target: EffectTarget) {
  const current = track.getProcessor() as Switchable | undefined;
  const currentKey = current ? (processorKeys.get(current) ?? "foreign") : "none";
  if (currentKey === target.key) return;

  if (!target.options) {
    if (current && currentKey !== "foreign") await track.stopProcessor();
    return;
  }
  if (current && currentKey !== "foreign" && typeof current.switchTo === "function") {
    // Same pipeline, new look: no flicker, no model reload.
    await current.switchTo(target.options);
    processorKeys.set(current, target.key);
    return;
  }
  // A muted camera has a stopped source track; the effect is applied when it comes back.
  if (track.isMuted) return;
  const mod = await loadProcessors();
  if (!mod.supportsBackgroundProcessors()) throw new Error("Background effects aren't supported in this browser.");
  const processor = createProcessor(mod, target.options);
  processorKeys.set(processor, target.key);
  await track.setProcessor(processor, true);
}

/** Puts `target` on `track`. Calls on the same track run one after another. */
export function applyEffect(track: LocalVideoTrack, target: EffectTarget): Promise<void> {
  const prev = chains.get(track) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => applyNow(track, target));
  chains.set(track, next);
  return next;
}

/** Resolves `userId`'s preferences and applies them to `track`. */
export async function applyPreferredEffect(track: LocalVideoTrack, userId: string): Promise<void> {
  const prefs = getEffectsStore(userId).getSnapshot();
  if (wantsProcessing(prefs) && !(await effectsSupported())) return;
  await applyEffect(track, await resolveTarget(prefs));
}

/** The camera publication's track, if I have one. */
export function localCameraTrack(room: Room | null | undefined): LocalVideoTrack | null {
  const pub = room?.localParticipant.getTrackPublication(Track.Source.Camera);
  return (pub?.track as LocalVideoTrack | undefined) ?? null;
}

const enabling = new WeakMap<Room, Promise<unknown>>();

function isDeviceError(err: unknown) {
  const f = MediaDeviceFailure.getFailure(err);
  return f !== undefined && f !== MediaDeviceFailure.Other;
}

/**
 * Turns my camera on with my chosen effect ALREADY applied, so nobody ever sees a frame of the
 * real background. Drop-in replacement for `localParticipant.setCameraEnabled(true, opts)`:
 * throws the same device errors. If the effect itself fails, the camera still turns on without it.
 */
export async function enableCameraWithEffects(room: Room, opts: VideoCaptureOptions, userId: string | undefined): Promise<void> {
  const lp = room.localParticipant;
  const prefs = userId ? getEffectsStore(userId).getSnapshot() : null;
  if (!prefs || !wantsProcessing(prefs)) {
    await lp.setCameraEnabled(true, opts);
    return;
  }
  const inflight = enabling.get(room);
  if (inflight) {
    await inflight;
    return;
  }
  const run = (async () => {
    if (!(await effectsSupported())) {
      await lp.setCameraEnabled(true, opts);
      return;
    }
    const existing = localCameraTrack(room);
    if (existing) {
      if (!existing.isMuted) return;
      if (existing.getProcessor()) {
        // Muted with our pipeline still attached: switch looks now, unmuting restarts it.
        await resolveTarget(prefs)
          .then((t) => applyEffect(existing, t))
          .catch(() => {});
        await lp.setCameraEnabled(true, opts);
        return;
      }
      // Muted without an effect: a processor can't start on a stopped source, and unmuting
      // first would flash the real background. Start over with a fresh, processed track.
      await lp.unpublishTrack(existing, true);
    }
    const deviceId = room.getActiveDevice("videoinput");
    const track = await createLocalVideoTrack({ ...room.options.videoCaptureDefaults, ...opts, ...(deviceId ? { deviceId } : null) });
    try {
      await applyEffect(track, await resolveTarget(prefs));
    } catch (err) {
      if (isDeviceError(err)) {
        track.stop();
        throw err;
      }
      toast.error("Your background effect couldn't be applied, so your camera is on without it.");
    }
    if (room.state === "disconnected") {
      track.stop();
      return;
    }
    // Someone else (another toggle) published a camera meanwhile: keep theirs.
    if (localCameraTrack(room)) {
      track.stop();
      await lp.setCameraEnabled(true, opts);
      return;
    }
    try {
      await lp.publishTrack(track, { source: Track.Source.Camera });
    } catch (err) {
      track.stop();
      throw err;
    }
  })();
  enabling.set(room, run);
  try {
    await run;
  } finally {
    if (enabling.get(room) === run) enabling.delete(room);
  }
}
