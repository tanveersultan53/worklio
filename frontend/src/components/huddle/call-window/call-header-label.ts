import type { CallKind } from "./types";

export type CallHeaderLabelInput = {
  /** How the call was started: `call.kind`, or the provider's kind while connecting. */
  kind: CallKind | null;
  /** True for a 1:1 call in a DM; channel huddles are everything else. */
  direct: boolean;
  /** True once the call row exists (`call` from `useCallInfo`); false while still connecting. */
  started: boolean;
  /** True while at least one participant is publishing a camera track. */
  cameraOn: boolean;
};

/**
 * The call window's header label.
 *
 * `call.kind` only records how the call started, so a channel huddle started from the Huddle
 * button is still "audio" after cameras come on. Huddles therefore follow the live camera state:
 * "Video call" while someone's camera is on, "Huddle" otherwise. 1:1 calls keep their labels.
 */
export function callHeaderLabel({ kind, direct, started, cameraOn }: CallHeaderLabelInput): "Video call" | "Audio call" | "Huddle" {
  if (kind === "video") return "Video call";
  if (!started) return "Huddle";
  if (direct) return "Audio call";
  return cameraOn ? "Video call" : "Huddle";
}
