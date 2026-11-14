"use client";

import { Captions, MicOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { UserAvatar } from "@/components/chat/user-avatar";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------------------------------
 * Live captions for calls.
 *
 *  - useLiveCaptions(): runs the browser's Web Speech API on MY microphone while captions are on and
 *    POSTs segments to /calls/{id}/captions (interims throttled to ~2/s, finals always).
 *  - useCaptionFeed(): collects everyone's `call.caption` events (plus my own, locally, for zero lag)
 *    into "last 2 lines per speaker" that fade out 6 s after the speaker goes quiet.
 *  - <CaptionsOverlay>: renders the feed at the bottom of the call stage.
 * -----------------------------------------------------------------------------------------------*/

export const CAPTIONS_UNSUPPORTED = "Live captions need Chrome or Edge";

/** Event broadcast to the call's channel for every caption segment. */
export type CallCaptionEvent = {
  type: "call.caption";
  call_id: string;
  user_id: string;
  text: string;
  final: boolean;
  ts: string;
};

export function asCaptionEvent(e: { type: string }): CallCaptionEvent | null {
  if (e.type !== "call.caption") return null;
  const c = e as Partial<CallCaptionEvent>;
  if (typeof c.call_id !== "string" || typeof c.user_id !== "string" || typeof c.text !== "string") return null;
  return { type: "call.caption", call_id: c.call_id, user_id: c.user_id, text: c.text, final: !!c.final, ts: c.ts ?? "" };
}

// --- Minimal Web Speech API typings (not in lib.dom for every TS version) ---

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; length: number; [i: number]: SpeechAlternative };
type SpeechResultEvent = { resultIndex: number; results: { length: number; [i: number]: SpeechResult } };
type SpeechErrorEvent = { error: string };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

/** Whether this browser can do speech recognition (false during SSR). */
export function useSpeechRecognitionSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => recognitionCtor() !== null,
    () => false,
  );
}

const INTERIM_INTERVAL_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const MAX_TEXT = 1_000;
const FATAL_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked, so live captions can't hear you.",
  "service-not-allowed": "This browser blocked speech recognition for live captions.",
  "audio-capture": "No microphone was found for live captions.",
  "language-not-supported": "Live captions don't support your browser language yet.",
};

const clip = (t: string) => (t.length > MAX_TEXT ? t.slice(t.length - MAX_TEXT) : t);

/**
 * Transcribe my microphone while `active`, POSTing segments to the call. `onLocal` receives every
 * interim/final immediately (for the local overlay); `onFatal` reports an unrecoverable error
 * (permission denied, no mic...) after which recognition stays stopped until `active` toggles.
 * Recognition is restarted automatically whenever the browser ends it while still active.
 */
export function useLiveCaptions({
  callId,
  active,
  onLocal,
  onFatal,
}: {
  callId: string | null;
  active: boolean;
  onLocal?: (text: string, final: boolean) => void;
  onFatal?: (message: string) => void;
}) {
  const cbs = useRef({ onLocal, onFatal });
  useEffect(() => {
    cbs.current = { onLocal, onFatal };
  });

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!active || !callId || !Ctor) return;

    let stopped = false;
    let rec: Recognition | null = null;
    let restartTimer: number | undefined;
    let interimTimer: number | undefined;
    let lastInterimSentAt = 0;
    let lastInterim = "";
    let startedAt: string | null = null;
    let backoffUntil = 0;
    let runStartedAt = 0;
    let restartDelay = 250;

    const send = (text: string, final: boolean) => {
      if (!final && Date.now() < backoffUntil) return;
      api<unknown>(`/calls/${callId}/captions`, {
        method: "POST",
        body: JSON.stringify({ text: clip(text), final, started_at: startedAt ?? new Date().toISOString() }),
      }).catch((err) => {
        if (err instanceof ApiError && err.status === 429) backoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      });
    };

    const flushInterimTimer = () => {
      window.clearTimeout(interimTimer);
      interimTimer = undefined;
    };

    const sendInterim = (text: string) => {
      const wait = INTERIM_INTERVAL_MS - (Date.now() - lastInterimSentAt);
      if (wait <= 0) {
        flushInterimTimer();
        lastInterimSentAt = Date.now();
        send(text, false);
        return;
      }
      if (interimTimer !== undefined) return; // trailing send already scheduled; it reads lastInterim
      interimTimer = window.setTimeout(() => {
        interimTimer = undefined;
        if (stopped || !lastInterim) return;
        lastInterimSentAt = Date.now();
        send(lastInterim, false);
      }, wait);
    };

    /** Close out a segment the browser never finalized (recognition ended or captions turned off). */
    const finalizeDangling = () => {
      flushInterimTimer();
      if (lastInterim) {
        send(lastInterim, true);
        cbs.current.onLocal?.(lastInterim, true);
      }
      lastInterim = "";
      startedAt = null;
    };

    const start = () => {
      if (stopped) return;
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";

      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const t = r?.[0]?.transcript ?? "";
          if (r?.isFinal) {
            const text = t.trim();
            if (text) {
              if (!startedAt) startedAt = new Date().toISOString();
              flushInterimTimer();
              send(text, true);
              cbs.current.onLocal?.(text, true);
            }
            startedAt = null;
            lastInterim = "";
          } else {
            interim += t;
          }
        }
        interim = interim.trim();
        if (interim && interim !== lastInterim) {
          if (!startedAt) startedAt = new Date().toISOString();
          lastInterim = interim;
          cbs.current.onLocal?.(interim, false);
          sendInterim(interim);
        }
      };

      rec.onerror = (ev) => {
        const fatal = FATAL_ERRORS[ev.error];
        if (!fatal) return; // no-speech / network / aborted: onend restarts us
        stopped = true;
        cbs.current.onFatal?.(fatal);
      };

      rec.onend = () => {
        finalizeDangling();
        if (stopped) return;
        // A run that dies almost immediately backs off (up to 5 s) so we never spin.
        restartDelay = Date.now() - runStartedAt < 1_500 ? Math.min(restartDelay * 2, 5_000) : 250;
        restartTimer = window.setTimeout(start, restartDelay);
      };

      runStartedAt = Date.now();
      try {
        rec.start();
      } catch {
        // InvalidStateError if a previous instance is still shutting down; try again shortly.
        restartTimer = window.setTimeout(start, 500);
      }
    };

    start();

    return () => {
      stopped = true;
      window.clearTimeout(restartTimer);
      finalizeDangling();
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        rec.onerror = null;
        try {
          rec.abort();
        } catch {
          // already stopped
        }
      }
    };
  }, [callId, active]);
}

// -------------------------------------------------------------------------------------------------
// Feed of everyone's captions
// -------------------------------------------------------------------------------------------------

export const CAPTION_VISIBLE_MS = 6_000;
const CAPTION_PRUNE_MS = CAPTION_VISIBLE_MS + 1_200;
const MAX_LINES = 2;
const MAX_SPEAKERS = 3;

type CaptionLine = { text: string; final: boolean };
export type SpeakerCaptions = { userId: string; lines: CaptionLine[]; at: number };
type Feed = Record<string, SpeakerCaptions>;

function addLine(feed: Feed, userId: string, text: string, final: boolean, at: number): Feed {
  const clean = text.trim();
  if (!clean) return feed;
  const cur = feed[userId];
  // Lines from a speaker who already faded out start fresh.
  const prev = cur && at - cur.at < CAPTION_VISIBLE_MS ? cur.lines : [];
  const lines = prev.length && !prev[prev.length - 1].final ? prev.slice(0, -1) : prev.slice();
  lines.push({ text: clean, final });
  return { ...feed, [userId]: { userId, lines: lines.slice(-MAX_LINES), at } };
}

function prune(feed: Feed, now: number): Feed {
  let changed = false;
  const next: Feed = {};
  for (const [id, s] of Object.entries(feed)) {
    if (now - s.at > CAPTION_PRUNE_MS) changed = true;
    else next[id] = s;
  }
  return changed ? next : feed;
}

/**
 * Everyone's live captions for `callId` while `enabled`. My own server echoes are ignored while
 * `localActive` (they arrive via `pushLocal` straight from the recognizer instead).
 */
export function useCaptionFeed(callId: string | null, meId: string | null | undefined, enabled: boolean, localActive: boolean) {
  const [feed, setFeed] = useState<Feed>({});
  const [now, setNow] = useState(0);

  useWorkspaceEvents((raw) => {
    if (!enabled || !callId) return;
    const ev = asCaptionEvent(raw as unknown as { type: string });
    if (!ev || ev.call_id !== callId) return;
    if (localActive && ev.user_id === meId) return;
    const at = Date.now();
    setNow(at);
    setFeed((f) => addLine(f, ev.user_id, ev.text, ev.final, at));
  });

  const pushLocal = (text: string, final: boolean) => {
    if (!meId || !enabled) return;
    const at = Date.now();
    setNow(at);
    setFeed((f) => addLine(f, meId, text, final, at));
  };

  const hasAny = Object.keys(feed).length > 0;
  useEffect(() => {
    if (!hasAny) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      setFeed((f) => prune(f, t));
    }, 500);
    return () => window.clearInterval(id);
  }, [hasAny]);

  const speakers = (enabled ? Object.values(feed) : [])
    .sort((a, b) => a.at - b.at)
    .slice(-MAX_SPEAKERS)
    .map((s) => ({ ...s, visible: now - s.at < CAPTION_VISIBLE_MS }));

  return { speakers, pushLocal };
}

// -------------------------------------------------------------------------------------------------
// Overlay
// -------------------------------------------------------------------------------------------------

/**
 * The captions strip between the call stage and the controls. It keeps a fixed height while
 * captions are on, so the video doesn't jump as people start and stop talking. Newest speaker at
 * the bottom; each speaker shows their last line or two. `notice` explains why MY speech isn't
 * being captioned (unsupported browser, muted); others' captions still show.
 */
export function CaptionsOverlay({
  speakers,
  notice,
  className,
}: {
  speakers: (SpeakerCaptions & { visible: boolean })[];
  notice?: { kind: "unsupported" | "muted"; text: string } | null;
  className?: string;
}) {
  const { me, memberById } = useWorkspace();
  const shown = speakers.filter((s) => s.visible).slice(-2);
  return (
    <section
      aria-label="Live captions"
      aria-live="polite"
      className={cn(
        "relative mx-auto flex h-[104px] w-full max-w-[880px] shrink-0 flex-col justify-end gap-2 overflow-hidden rounded-2xl bg-black/55 px-4 py-3 ring-1 ring-white/[0.08] sm:h-[112px] sm:px-5",
        className,
      )}
    >
      {notice && (
        <span
          role="status"
          className={cn(
            "absolute top-2.5 right-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
            notice.kind === "unsupported"
              ? "bg-amber-400/15 text-amber-100 ring-amber-300/25"
              : "bg-white/[0.06] text-white/65 ring-white/10",
          )}
        >
          {notice.kind === "muted" ? <MicOff className="size-3" aria-hidden /> : <Captions className="size-3" aria-hidden />}
          {notice.text}
        </span>
      )}
      {shown.length === 0 && (
        <p className="flex items-center gap-2 self-center pb-5 text-sm text-white/45">
          <Captions className="size-4" aria-hidden />
          Captions will appear here when someone speaks.
        </p>
      )}
      {shown.map((s) => {
        const name = s.userId === me?.id ? "You" : (memberById[s.userId]?.full_name ?? "Someone");
        const last = s.lines[s.lines.length - 1];
        const text = s.lines.map((l) => l.text).join(" ");
        return (
          <div key={s.userId} className="flex min-w-0 items-start gap-3 animate-in fade-in-0 duration-200">
            <UserAvatar
              id={s.userId}
              name={memberById[s.userId]?.full_name ?? name}
              size="sm"
              className="mt-[3px] shrink-0"
              ringClassName="border-transparent"
            />
            {/* Two lines tall, pinned to the bottom: long speech scrolls off the top, newest words stay. */}
            <span className="mt-[3px] w-[7.5rem] shrink-0 truncate text-[15px] font-semibold text-white/60" title={name}>
              {name}
            </span>
            <div className="flex max-h-[2.8em] min-w-0 flex-1 flex-col justify-end overflow-hidden text-[17px] leading-[1.4] sm:text-lg">
              <p className={cn("text-white [overflow-wrap:anywhere]", !last?.final && "text-white/90")}>{text}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}
