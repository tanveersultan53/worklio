"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useWorkspace } from "@/components/workspace/provider";

import { CUSTOM_IMAGE_MAX_BYTES, CUSTOM_IMAGE_TYPES, type EffectId, isEffectId } from "./presets";
import { isStudioLevel, type StudioLevel } from "./studio";

/**
 * Per-user camera-effect preferences.
 *  - `effect` and `mirror` live in localStorage (`worklio.effects.v1.<userId>`).
 *  - An uploaded background never leaves the device: the file is kept in IndexedDB and exposed
 *    as an object URL (`customUrl`) for this page's lifetime.
 * Every read/write is wrapped: with storage blocked the prefs simply last for this page.
 */

export type EffectsSnapshot = {
  effect: EffectId;
  /** Studio look: on-device light, noise, colour and clarity enhancement. */
  studio: StudioLevel;
  /** Flip my own camera preview horizontally (local only; others always see the true image). */
  mirror: boolean;
  /** Object URL of my uploaded background, or null. */
  customUrl: string | null;
  /** False until IndexedDB has been checked for an uploaded background. */
  customLoaded: boolean;
};

const DEFAULTS: EffectsSnapshot = Object.freeze({ effect: "none", studio: "off", mirror: true, customUrl: null, customLoaded: false });

const KEY_PREFIX = "worklio.effects.v1.";
const DB_NAME = "worklio-effects";
const DB_STORE = "images";

// --- IndexedDB (tiny promise wrapper; every failure resolves to "nothing stored") ---

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, mode);
      const req = run(tx.objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

// --- Store ---

class EffectsStore {
  private snap: EffectsSnapshot;
  private listeners = new Set<() => void>();

  constructor(private readonly userId: string) {
    this.snap = { ...DEFAULTS, ...this.readLocal() };
    void this.loadCustom();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private get key() {
    return KEY_PREFIX + this.userId;
  }

  private readLocal(): Partial<EffectsSnapshot> {
    try {
      const raw = JSON.parse(localStorage.getItem(this.key) ?? "{}") as { effect?: unknown; mirror?: unknown; studio?: unknown };
      return {
        ...(isEffectId(raw.effect) ? { effect: raw.effect } : null),
        ...(isStudioLevel(raw.studio) ? { studio: raw.studio } : null),
        ...(typeof raw.mirror === "boolean" ? { mirror: raw.mirror } : null),
      };
    } catch {
      return {};
    }
  }

  private writeLocal() {
    try {
      localStorage.setItem(this.key, JSON.stringify({ effect: this.snap.effect, studio: this.snap.studio, mirror: this.snap.mirror }));
    } catch {
      // storage blocked: keep the choice for this page only
    }
  }

  private set(patch: Partial<EffectsSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private async loadCustom() {
    const blob = await idb<Blob | undefined>("readonly", (s) => s.get(this.userId) as IDBRequest<Blob | undefined>);
    if (this.snap.customUrl) return; // an upload landed while we were reading
    const url = blob instanceof Blob ? URL.createObjectURL(blob) : null;
    // "custom" without a stored image falls back to no effect.
    const effect = !url && this.snap.effect === "custom" ? "none" : this.snap.effect;
    this.set({ customUrl: url, customLoaded: true, effect });
  }

  setEffect = (effect: EffectId) => {
    if (effect === "custom" && !this.snap.customUrl) return;
    if (effect === this.snap.effect) return;
    this.set({ effect });
    this.writeLocal();
  };

  setStudio = (studio: StudioLevel) => {
    if (studio === this.snap.studio) return;
    this.set({ studio });
    this.writeLocal();
  };

  setMirror = (mirror: boolean) => {
    if (mirror === this.snap.mirror) return;
    this.set({ mirror });
    this.writeLocal();
  };

  /** Validates, stores and selects an uploaded background. Resolves to an error message or null. */
  setCustomImage = async (file: File): Promise<string | null> => {
    if (!(CUSTOM_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Pick a JPG, PNG or WebP image.";
    if (file.size > CUSTOM_IMAGE_MAX_BYTES) return "That image is larger than 8 MB.";
    const ok = await canDecode(file);
    if (!ok) return "That image couldn't be opened.";
    const blob = file.slice(0, file.size, file.type);
    void idb("readwrite", (s) => s.put(blob, this.userId));
    const prev = this.snap.customUrl;
    this.set({ customUrl: URL.createObjectURL(blob), customLoaded: true, effect: "custom" });
    this.writeLocal();
    if (prev) URL.revokeObjectURL(prev);
    return null;
  };

  clearCustomImage = () => {
    const prev = this.snap.customUrl;
    void idb("readwrite", (s) => s.delete(this.userId));
    this.set({ customUrl: null, effect: this.snap.effect === "custom" ? "none" : this.snap.effect });
    this.writeLocal();
    if (prev) URL.revokeObjectURL(prev);
  };
}

async function canDecode(file: Blob): Promise<boolean> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      bmp.close();
      return true;
    }
  } catch {
    return false;
  }
  return true;
}

const stores = new Map<string, EffectsStore>();

/** The (lazily created) effects store of a user. Client only. */
export function getEffectsStore(userId: string): EffectsStore {
  let s = stores.get(userId);
  if (!s) {
    s = new EffectsStore(userId);
    stores.set(userId, s);
  }
  return s;
}

const SERVER_STORE = { subscribe: () => () => {}, getSnapshot: () => DEFAULTS };

/** My effect preferences plus setters. Must be rendered inside the workspace provider. */
export function useEffectsPrefs() {
  const { me } = useWorkspace();
  const userId = me?.id ?? "anonymous";
  const subscribe = useCallback((fn: () => void) => getEffectsStore(userId).subscribe(fn), [userId]);
  const getSnapshot = useCallback(() => getEffectsStore(userId).getSnapshot(), [userId]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, SERVER_STORE.getSnapshot);
  const actions = useMemo(() => {
    if (typeof window === "undefined") {
      return { setEffect: () => {}, setStudio: () => {}, setMirror: () => {}, setCustomImage: async () => null, clearCustomImage: () => {} };
    }
    const s = getEffectsStore(userId);
    return {
      setEffect: s.setEffect,
      setStudio: s.setStudio,
      setMirror: s.setMirror,
      setCustomImage: s.setCustomImage as (file: File) => Promise<string | null>,
      clearCustomImage: s.clearCustomImage,
    };
  }, [userId]);
  return { ...snap, ...actions, userId };
}

/** Whether my own camera preview should be mirrored. */
export function useMirrorSelf(): boolean {
  return useEffectsPrefs().mirror;
}
