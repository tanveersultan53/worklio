"use client";

import { useSyncExternalStore } from "react";

/**
 * In-app navigation history for the top bar's ← → buttons (Slack-style) and the 🕘 recent list.
 *
 * - The back/forward stack mirrors the pages visited in this tab. Our own ← / → mark the move
 *   as "travel" so it isn't recorded as a new visit (which would wipe the forward entries).
 * - Recently viewed conversations are kept per workspace in localStorage (most recent first).
 */

type Snapshot = { entries: string[]; index: number };

let snap: Snapshot = { entries: [], index: -1 };
let travelTo: number | null = null;
const listeners = new Set<() => void>();
const MAX_ENTRIES = 100;

function set(next: Snapshot) {
  snap = next;
  listeners.forEach((fn) => fn());
}

/** Call on every route change (the shell does). */
export function recordVisit(path: string) {
  if (travelTo !== null && snap.entries[travelTo] === path) {
    set({ entries: snap.entries, index: travelTo });
    travelTo = null;
    return;
  }
  travelTo = null;
  if (snap.entries[snap.index] === path) return;
  const entries = [...snap.entries.slice(0, snap.index + 1), path].slice(-MAX_ENTRIES);
  set({ entries, index: entries.length - 1 });
}

/** The path to open for ← (-1) or → (+1), marking it as travel. Null when there's nowhere to go. */
export function travel(step: -1 | 1): string | null {
  const target = snap.index + step;
  if (target < 0 || target >= snap.entries.length) return null;
  travelTo = target;
  return snap.entries[target];
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const SERVER: Snapshot = { entries: [], index: -1 };

export function useNavHistory(): { canBack: boolean; canForward: boolean } {
  const s = useSyncExternalStore(subscribe, () => snap, () => SERVER);
  return { canBack: s.index > 0, canForward: s.index >= 0 && s.index < s.entries.length - 1 };
}

// --- Recently viewed conversations ---

const RECENT_MAX = 20;
const recentKey = (ws: string) => `worklio.recent.${ws}`;
const recentListeners = new Set<() => void>();
const recentCache = new Map<string, string[]>();

function readRecent(ws: string): string[] {
  const cached = recentCache.get(ws);
  if (cached) return cached;
  let list: string[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(ws)) ?? "[]");
    if (Array.isArray(raw)) list = raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX);
  } catch {
    list = [];
  }
  recentCache.set(ws, list);
  return list;
}

/** Note that a conversation was opened. */
export function recordRecent(ws: string, channelId: string) {
  const prev = readRecent(ws);
  if (prev[0] === channelId) return;
  const next = [channelId, ...prev.filter((id) => id !== channelId)].slice(0, RECENT_MAX);
  recentCache.set(ws, next);
  try {
    localStorage.setItem(recentKey(ws), JSON.stringify(next));
  } catch {
    // storage blocked: this page still remembers
  }
  recentListeners.forEach((fn) => fn());
}

const EMPTY: string[] = [];

export function useRecentConversations(ws: string): string[] {
  return useSyncExternalStore(
    (fn) => {
      recentListeners.add(fn);
      return () => {
        recentListeners.delete(fn);
      };
    },
    () => (ws ? readRecent(ws) : EMPTY),
    () => EMPTY,
  );
}
