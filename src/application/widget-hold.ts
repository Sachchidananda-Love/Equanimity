type Point = { pointerId: number; clientX: number; clientY: number };

/** A long press opens edit mode, never captures a scrolling pointer. */
export function createWidgetHold() {
  let start: Point | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const cancel = (pointerId?: number) => {
    if (pointerId !== undefined && start?.pointerId !== pointerId) return;
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    start = null;
  };
  return {
    start(point: Point, openEdit: () => void) {
      cancel();
      start = point;
      const current = generation;
      timer = setTimeout(() => {
        if (generation !== current || !start) return;
        cancel();
        openEdit();
      }, 450);
    },
    move(point: Point) {
      if (start?.pointerId === point.pointerId && Math.hypot(point.clientX - start.clientX, point.clientY - start.clientY) > 6) cancel();
    },
    cancel,
  };
}

/** Controls, labels and nested scroll content keep their own native gestures. */
export function widgetOwnsGesture(target: HTMLElement, widget: HTMLElement) {
  if (target.closest("button,input,label,output,textarea,select,a,[role=button],[contenteditable=true]")) return true;
  for (let node: HTMLElement | null = target; node && node !== widget; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
      const style = node.ownerDocument.defaultView?.getComputedStyle(node);
      if (style && /auto|scroll/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) return true;
    }
  }
  return false;
}
