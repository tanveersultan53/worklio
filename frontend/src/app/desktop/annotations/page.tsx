"use client";

import { useEffect, useRef } from "react";

import { type AnnotationOp, isAnimating, renderAnnotations } from "@/components/annotate";
import { isExpired } from "@/components/annotate/render";
import { desktopBridge } from "@/lib/desktop";

/**
 * Desktop app only: the transparent layer drawn over a screen I'm sharing. The shell loads this
 * page in a click-through, always-on-top window that is excluded from screen capture, and feeds
 * it everyone's annotation ops. In a normal browser it renders an empty page.
 */
export default function DesktopAnnotationsOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // The window is transparent; so must the page be.
    const prev = [document.documentElement.style.background, document.body.style.background];
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      [document.documentElement.style.background, document.body.style.background] = prev;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bridge = desktopBridge()?.annotations;
    if (!canvas || !bridge?.onOp) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let ops: AnnotationOp[] = [];
    let index = new Map<string, number>();
    let dirty = true;
    let lastPrune = 0;
    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      dirty = true;
    };
    resize();
    window.addEventListener("resize", resize);

    const offOp = bridge.onOp((value) => {
      const raw = value as AnnotationOp | null;
      if (!raw || typeof raw.id !== "string" || typeof raw.kind !== "string") return;
      const now = Date.now();
      // Re-base the sender's clock onto ours so fades and laser trails age correctly.
      const skew = now - (Number(raw.t) || now);
      const op: AnnotationOp =
        raw.kind === "laser"
          ? { ...raw, t: now, points: (raw.points ?? []).map((p) => [p[0], p[1], (p[2] ?? raw.t) + skew]) }
          : { ...raw, t: now };
      const i = index.get(op.id);
      if (i == null) {
        index.set(op.id, ops.length);
        ops.push(op);
      } else {
        ops[i] = op;
      }
      dirty = true;
    });
    const offReset = bridge.onReset?.(() => {
      ops = [];
      index = new Map();
      dirty = true;
    });

    const tick = () => {
      const now = Date.now();
      if (now - lastPrune > 2000) {
        lastPrune = now;
        if (ops.some((op) => isExpired(op, now))) {
          ops = ops.filter((op) => !isExpired(op, now));
          index = new Map(ops.map((op, i) => [op.id, i]));
          dirty = true;
        }
      }
      if (dirty || isAnimating(ops, now)) {
        dirty = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderAnnotations(ctx, ops, canvas.width, canvas.height, now);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      offOp();
      offReset?.();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 size-full" />;
}
