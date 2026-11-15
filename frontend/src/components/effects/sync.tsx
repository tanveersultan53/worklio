"use client";

import { type Room, RoomEvent } from "livekit-client";
import { useEffect } from "react";

import { toast } from "@/lib/toast";

import { applyEffect, effectsSupported, localCameraTrack, resolveTarget, wantsProcessing } from "./engine";
import { getEffectsStore } from "./store";

/**
 * Keeps my published camera in line with my effect preference: re-applies whenever the camera is
 * (re)published, unmuted or switched to another device, and whenever the preference changes.
 * Renders nothing; mount once per connected room.
 */
export function CameraEffectsSync({ room, userId }: { room: Room | null; userId: string | undefined }) {
  useEffect(() => {
    if (!room || !userId) return;
    const store = getEffectsStore(userId);
    let alive = true;
    let failedKey: string | null = null;

    const sync = async () => {
      const track = localCameraTrack(room);
      if (!track || !alive) return;
      const prefs = store.getSnapshot();
      if (wantsProcessing(prefs) && !(await effectsSupported())) return;
      let key = "none";
      try {
        const target = await resolveTarget(prefs);
        key = target.key;
        if (!alive) return;
        await applyEffect(track, target);
        failedKey = null;
      } catch {
        if (!alive || failedKey === key) return;
        failedKey = key;
        toast.error("Couldn't apply your background effect. Your camera is showing without it.");
      }
    };
    const run = () => void sync();

    const unsubscribe = store.subscribe(run);
    room.on(RoomEvent.LocalTrackPublished, run);
    room.on(RoomEvent.TrackUnmuted, run);
    room.on(RoomEvent.ActiveDeviceChanged, run);
    run();
    return () => {
      alive = false;
      unsubscribe();
      room.off(RoomEvent.LocalTrackPublished, run);
      room.off(RoomEvent.TrackUnmuted, run);
      room.off(RoomEvent.ActiveDeviceChanged, run);
    };
  }, [room, userId]);
  return null;
}
