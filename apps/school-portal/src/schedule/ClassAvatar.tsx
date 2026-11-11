import React from 'react';

/** How many soft avatar colours schedule.css defines (`u8s-avatar--c0` …). */
const COLOURS = 6;

/** "Advanced (Gi)" → "AG": the first letter of the first two words. */
export function classInitials(title: string): string {
  const words = title
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

function colourIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % COLOURS;
}

/**
 * A class's avatar (DESIGN.md → "Avatars: one shape, the circle"): the class's
 * own banner cropped to a circle, or its initials on a soft colour. `colourKey`
 * keeps one class (or one timetable slot's every date) the same colour.
 * 40px in a list row on a computer, 44px on a phone (schedule.css).
 */
export function ClassAvatar({ title, bannerUrl, colourKey }: { title: string; bannerUrl?: string | null; colourKey: string }) {
  if (bannerUrl) return <img className="u8s-avatar" src={bannerUrl} alt="" />;
  return (
    <span className={`u8s-avatar u8s-avatar--c${colourIndex(colourKey)}`} aria-hidden="true">
      {classInitials(title)}
    </span>
  );
}
