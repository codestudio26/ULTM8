import type React from 'react';
import { useState } from 'react';

/** The list with the item at `from` moved to `to`; the others shift along. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Drag to reorder a list (Decision 152.2): a handle on each row starts the
 * drag, and dropping on another row moves it there. Mouse and touchpad only;
 * the rows' ↑/↓ buttons stay for the keyboard. Nothing is saved here: the
 * caller's own save and confirmation run as before. */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => {
    setDragging(null);
    setOver(null);
  };
  return {
    /** The row being dragged over, to highlight where it will land. */
    over,
    handleProps: (i: number, label: string) => ({
      draggable: true,
      'aria-hidden': true as const,
      title: `Drag to reorder ${label}`,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        setDragging(i);
      },
      onDragEnd: reset,
      style: { cursor: 'grab', userSelect: 'none' as const, padding: '0 4px', color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1 },
    }),
    targetProps: (i: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (dragging === null) return;
        e.preventDefault();
        if (over !== i) setOver(i);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragging !== null && dragging !== i) onMove(dragging, i);
        reset();
      },
    }),
  };
}
