import type React from 'react';
import { useRef, useState } from 'react';
import { useT } from '../i18n/I18nProvider';

/** The list with the item at `from` moved to `to`; the others shift along. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Drag to reorder a list (Decision 152.2; DESIGN.md → "Drag and drop on the
 * ladder"): grab a row by its ⠿ handle and drop it on another row. Pointer
 * events, so a mouse and a finger both work and no text gets selected; the
 * rows' ↑/↓ buttons stay for the keyboard. While dragging, the row under the
 * pointer is `over` (to draw where it lands) and the dragged row is
 * `dragging` (to fade it). Nothing is saved here: the caller's own save and
 * confirmation run as before. Rows carry `targetProps(i)`, which tags them
 * with their index so the drop can find them under the pointer. */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const scope = useRef(`drag-${Math.random().toString(36).slice(2)}`);
  const t = useT();

  const rowAt = (x: number, y: number): number | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[data-drag-scope="${scope.current}"]`);
    return hit ? Number(hit.dataset.dragIndex) : null;
  };

  return {
    over,
    dragging,
    handleProps: (i: number, label: string) => ({
      'aria-hidden': true as const,
      title: t('ranks.dragToReorder', { label }),
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(i);
        setOver(i);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (dragging === null) return;
        const row = rowAt(e.clientX, e.clientY);
        if (row !== null && row !== over) setOver(row);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        if (dragging === null) return;
        const row = rowAt(e.clientX, e.clientY) ?? over;
        if (row !== null && row !== dragging) onMove(dragging, row);
        setDragging(null);
        setOver(null);
      },
      onPointerCancel: () => {
        setDragging(null);
        setOver(null);
      },
      style: { cursor: 'grab', userSelect: 'none' as const, touchAction: 'none' as const, padding: '0 4px', color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1 },
    }),
    targetProps: (i: number) => ({
      'data-drag-scope': scope.current,
      'data-drag-index': i,
    }),
    /** Row styles while dragging: the dragged row fades, a green line marks where it lands. */
    rowStyle: (i: number): React.CSSProperties => ({
      opacity: dragging === i ? 0.45 : 1,
      boxShadow: over === i && dragging !== null && dragging !== i ? `0 ${dragging < i ? 3 : -3}px 0 0 #9fd3b2` : undefined,
    }),
  };
}
