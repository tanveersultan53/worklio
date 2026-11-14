"use client";

import { type Room, RoomEvent, Track } from "livekit-client";
import { useEffect } from "react";

import { getCallRoomData } from "@/components/huddle/call-window/room-data";
import { desktopBridge } from "@/lib/desktop";

/**
 * Desktop app only: while I share a whole screen, forward everyone's annotations on my share to
 * the desktop shell, which draws them in a transparent, click-through layer over that screen (so
 * I see them over whatever I'm presenting, not only inside Worklio). Window and tab shares stay
 * in-app: we can't line a drawing up with another app's window. Renders nothing.
 */
export function DesktopAnnotationBridge({ room }: { room: Room | null }) {
  useEffect(() => {
    const bridge = desktopBridge()?.annotations;
    if (!room || !bridge) return;
    let activeKey = "";
    let unsubscribe: (() => void) | null = null;

    const sync = () => {
      const lp = room.localParticipant;
      const pub = lp.getTrackPublication(Track.Source.ScreenShare);
      const settings = (pub?.track?.mediaStreamTrack.getSettings() ?? {}) as MediaTrackSettings & { displaySurface?: string };
      const key = pub?.trackSid && settings.displaySurface === "monitor" ? `${lp.identity}:${pub.trackSid}` : "";
      if (key === activeKey) return;
      unsubscribe?.();
      unsubscribe = null;
      if (activeKey) bridge.stop();
      activeKey = key;
      if (!key) return;
      bridge.start({ width: settings.width ?? 0, height: settings.height ?? 0 });
      unsubscribe = getCallRoomData(room).subscribeAnnotations(key, (op) => bridge.op(op));
    };

    sync();
    room.on(RoomEvent.LocalTrackPublished, sync);
    room.on(RoomEvent.LocalTrackUnpublished, sync);
    room.on(RoomEvent.Disconnected, sync);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, sync);
      room.off(RoomEvent.LocalTrackUnpublished, sync);
      room.off(RoomEvent.Disconnected, sync);
      unsubscribe?.();
      if (activeKey) bridge.stop();
    };
  }, [room]);
  return null;
}
