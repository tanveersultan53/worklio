import {
  ConnectionQuality,
  MediaDeviceFailure,
  type Participant,
  type RemoteTrack,
  type Room,
  RoomEvent,
  Track,
  type VideoTrack,
} from "livekit-client";

import type { HuddleParticipantView, HuddleRoomSnapshot } from "./types";

export const EMPTY_ROOM_SNAPSHOT: HuddleRoomSnapshot = Object.freeze({
  participants: [],
  speakingIds: [],
  micEnabled: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  quality: ConnectionQuality.Unknown,
  canPlayAudio: true,
}) as HuddleRoomSnapshot;

/** A store with no room, for `useSyncExternalStore` while not in a huddle. */
export const IDLE_STORE = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_ROOM_SNAPSHOT,
};

const ROOM_EVENTS: RoomEvent[] = [
  RoomEvent.Connected,
  RoomEvent.Reconnected,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionQualityChanged,
  RoomEvent.AudioPlaybackStatusChanged,
];

function videoTrack(p: Participant, source: Track.Source): VideoTrack | null {
  const pub = p.getTrackPublication(source);
  if (!pub || pub.isMuted || !pub.track) return null;
  return pub.track as VideoTrack;
}

function view(p: Participant, speaking: Set<string>): HuddleParticipantView {
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal: p.isLocal,
    speaking: speaking.has(p.identity),
    micEnabled: p.isMicrophoneEnabled,
    cameraTrack: videoTrack(p, Track.Source.Camera),
    screenTrack: videoTrack(p, Track.Source.ScreenShare),
    quality: p.connectionQuality,
  };
}

/**
 * Wraps a LiveKit Room as an external store with a referentially stable snapshot
 * (recomputed only on room events), and plays remote audio through hidden <audio> elements.
 */
export class HuddleRoomStore {
  private listeners = new Set<() => void>();
  private snapshot: HuddleRoomSnapshot = EMPTY_ROOM_SNAPSHOT;
  private disposed = false;

  constructor(readonly room: Room) {
    for (const ev of ROOM_EVENTS) room.on(ev, this.recompute);
    room.on(RoomEvent.TrackSubscribed, this.attachAudio);
    room.on(RoomEvent.TrackUnsubscribed, this.detachAudio);
    this.recompute();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  private recompute = () => {
    if (this.disposed) return;
    const room = this.room;
    const speakingIds = room.activeSpeakers.map((p) => p.identity);
    const speaking = new Set(speakingIds);
    const local = room.localParticipant;
    this.snapshot = {
      participants: [local, ...room.remoteParticipants.values()].map((p) => view(p, speaking)),
      speakingIds,
      micEnabled: local.isMicrophoneEnabled,
      cameraEnabled: local.isCameraEnabled,
      screenShareEnabled: local.isScreenShareEnabled,
      quality: local.connectionQuality,
      canPlayAudio: room.canPlaybackAudio,
    };
    this.listeners.forEach((fn) => fn());
  };

  private attachAudio = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    const el = track.attach();
    el.dataset.huddleAudio = "";
    document.body.appendChild(el);
  };

  private detachAudio = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return;
    track.detach().forEach((el) => el.remove());
  };

  /** Stops listening and removes every audio element this store created. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const ev of ROOM_EVENTS) this.room.off(ev, this.recompute);
    this.room.off(RoomEvent.TrackSubscribed, this.attachAudio);
    this.room.off(RoomEvent.TrackUnsubscribed, this.detachAudio);
    for (const p of this.room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) pub.track?.detach().forEach((el) => el.remove());
    }
    this.snapshot = EMPTY_ROOM_SNAPSHOT;
    this.listeners.forEach((fn) => fn());
    this.listeners.clear();
  }
}

/** Human message for a getUserMedia / getDisplayMedia failure. */
export function mediaErrorMessage(err: unknown, device: "microphone" | "camera" | "screen"): string {
  const failure = MediaDeviceFailure.getFailure(err);
  const label = device === "screen" ? "Screen sharing" : device === "camera" ? "Camera" : "Microphone";
  if (device === "screen" && failure !== MediaDeviceFailure.PermissionDenied) {
    return "Couldn't start screen sharing. Try again, or pick a different screen or window.";
  }
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return `${label} access is blocked. Allow it in your browser's site settings and try again.`;
    case MediaDeviceFailure.NotFound:
      return `No ${device === "screen" ? "screen" : device} was found.`;
    case MediaDeviceFailure.DeviceInUse:
      return `Your ${device} is being used by another app.`;
    default:
      return `${label} couldn't be started.`;
  }
}

/** True when the user just closed the browser's screen picker (not worth a toast). */
export function isUserCancelled(err: unknown): boolean {
  return err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError");
}

export function canScreenShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}
