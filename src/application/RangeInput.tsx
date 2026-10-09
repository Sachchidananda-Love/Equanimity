"use client";

import { useCallback, useEffect, useRef, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
};
type Gesture = {
  node: HTMLInputElement;
  pointerId: number;
  x: number;
  y: number;
  horizontal: boolean;
  lastValue: number;
  detach: () => void;
};

/** Native rendering/taps/keyboard; touch track drags need only this enhancement. */
export function RangeInput({ value, onValueChange, ...props }: Props) {
  const gesture = useRef<Gesture | null>(null);
  const stop = useCallback(() => {
    const current = gesture.current;
    gesture.current = null; // releasing capture can synchronously notify listeners
    if (!current) return;
    current.detach();
    if (current.node.hasPointerCapture(current.pointerId)) current.node.releasePointerCapture(current.pointerId);
  }, []);
  useEffect(() => stop, [stop]);

  const update = (current: Gesture, clientX: number) => {
    const rect = current.node.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = rangeValueAtPosition(current.node, clientX, rect.left, rect.width);
    current.lastValue = next;
    // Keep native rendering in sync immediately, even before React's next commit.
    current.node.value = String(next);
    onValueChange(next);
  };

  return <input {...props} type="range" value={value}
    onChange={event => {
      const current = gesture.current;
      if (current?.horizontal) {
        // Native thumb dragging can emit another input after our pointer event.
        // The same horizontal gesture must have only one value owner.
        event.currentTarget.value = String(current.lastValue);
        return;
      }
      onValueChange(Number(event.currentTarget.value));
    }}
    onPointerDown={event => {
      stop();
      if (event.currentTarget.disabled || !event.isPrimary || event.button !== 0 || !["touch", "pen"].includes(event.pointerType)) return;
      const node = event.currentTarget, doc = node.ownerDocument, win = doc.defaultView;
      const hidden = () => { if (doc.visibilityState === "hidden") stop(); };
      // Lifecycle-only listeners exist while a finger is down; never global move/up.
      doc.addEventListener("visibilitychange", hidden);
      win?.addEventListener("blur", stop);
      gesture.current = {
        node, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        horizontal: false, lastValue: Number(node.value),
        detach: () => { doc.removeEventListener("visibilitychange", hidden); win?.removeEventListener("blur", stop); },
      };
    }}
    onPointerMove={event => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.horizontal) {
        const dx = Math.abs(event.clientX - current.x), dy = Math.abs(event.clientY - current.y);
        if (dy >= 6 && dy >= dx) { stop(); return; }
        if (dx < 6 || dx < dy * 1.5) return;
        current.horizontal = true;
        current.node.setPointerCapture(current.pointerId);
      }
      update(current, event.clientX);
    }}
    onPointerUp={event => {
      const current = gesture.current;
      if (current?.pointerId !== event.pointerId) return;
      if (current.horizontal) update(current, event.clientX);
      stop();
    }}
    onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) stop(); }}
    onLostPointerCapture={event => {
      const current = gesture.current;
      // An internal/native capture handoff can notify the host while our new
      // capture is already pending. End only when this input actually lost it.
      if (current?.pointerId === event.pointerId && !current.node.hasPointerCapture(event.pointerId)) stop();
    }}
    onBlur={stop}
    onKeyDown={stop}
  />;
}

/** Map the full interactive track to the input's native bounds and step. */
export function rangeValueAtPosition(input: Pick<HTMLInputElement, "min" | "max" | "step" | "dir">, x: number, left: number, width: number) {
  const min = input.min === "" ? 0 : Number(input.min), max = input.max === "" ? 100 : Number(input.max);
  if (max <= min || width <= 0) return min;
  const ratio = Math.max(0, Math.min(1, (x - left) / width));
  const raw = min + (input.dir === "rtl" ? 1 - ratio : ratio) * (max - min);
  const step = input.step === "any" ? null : Number(input.step) || 1;
  const next = step === null ? raw : min + Math.round((raw - min) / step) * step;
  return Number(Math.max(min, Math.min(max, next)).toFixed(10));
}
