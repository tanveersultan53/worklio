"use client";

import { useSyncExternalStore } from "react";

/** Which optional tabs (canvas, board, whiteboard, files) a person hid in each channel, on this device. */

const key = (channelId: string) => `worklio.tabs.hidden.${channelId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, string[]>();
const EMPTY: string[] = [];

function read(channelId: string): string[] {
  const hit = cache.get(channelId);
  if (hit) return hit;
  let list: string[] = EMPTY;
  try {
    const raw = JSON.parse(localStorage.getItem(key(channelId)) ?? "[]");
    if (Array.isArray(raw)) list = raw.filter((x): x is string => typeof x === "string");
  } catch {
    list = EMPTY;
  }
  cache.set(channelId, list);
  return list;
}

export function setTabHidden(channelId: string, tab: string, hidden: boolean) {
  const prev = read(channelId);
  const next = hidden ? [...new Set([...prev, tab])] : prev.filter((t) => t !== tab);
  cache.set(channelId, next);
  try {
    localStorage.setItem(key(channelId), JSON.stringify(next));
  } catch {
    // storage blocked: this page still remembers
  }
  listeners.forEach((fn) => fn());
}

export function useHiddenTabs(channelId: string): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => read(channelId),
    () => EMPTY,
  );
}
