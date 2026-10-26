import React from 'react';
import type { Rung } from './ladder';

type Segment = { count: number; colour: string };

/** A small belt picture for a rung: the belt's colour, and the tag with this
 * rung's stripes. A two-tone belt has its second colour as a band through the
 * middle 30%, like a real Grey/White kids' belt (DESIGN.md → "Belt picture").
 * Colours are the school's own free text; an unknown one simply doesn't paint
 * (CSS ignores it), as on the Disciplines page. Decorative: the rung name is
 * always shown next to it. `large` is the 168 × 30 picture in a panel. */
export function BeltChip({ rung, large = false }: { rung: Rung; large?: boolean }) {
  const { rank, tier } = rung;
  const segments = (tier.stripeSegments ?? []) as Segment[];
  const stripes = segments.flatMap((s) => Array.from({ length: s.count }, () => s.colour));
  const belt = rank.secondaryColour
    ? `linear-gradient(to bottom, ${rank.primaryColour} 35%, ${rank.secondaryColour} 35%, ${rank.secondaryColour} 65%, ${rank.primaryColour} 65%)`
    : rank.primaryColour;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        alignItems: 'stretch',
        width: large ? 168 : 72,
        height: large ? 30 : 16,
        borderRadius: 3,
        border: '1px solid var(--border-strong)',
        background: belt,
        overflow: 'hidden',
      }}
    >
      <span style={{ flex: 1 }} />
      <span
        style={{
          display: 'inline-flex',
          gap: 2,
          alignItems: 'stretch',
          padding: '0 3px',
          minWidth: large ? 36 : 18,
          background: rank.tagColour ?? '#000000',
        }}
      >
        {stripes.map((colour, i) => (
          <span key={i} style={{ width: 3, background: colour }} />
        ))}
      </span>
      <span style={{ width: 8 }} />
    </span>
  );
}
