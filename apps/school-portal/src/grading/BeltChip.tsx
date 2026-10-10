import React from 'react';
import type { Rung } from './ladder';

type Segment = { count: number; colour: string };

/** A small belt picture for a rung: the belt's colour (two-tone when it has a
 * second colour), and the tag with this rung's stripes. Colours are the
 * school's own free text; an unknown one simply doesn't paint (CSS ignores
 * it), as on the Disciplines page. Decorative: the rung name is always shown
 * next to it. */
export function BeltChip({ rung }: { rung: Rung }) {
  const { rank, tier } = rung;
  const segments = (tier.stripeSegments ?? []) as Segment[];
  const stripes = segments.flatMap((s) => Array.from({ length: s.count }, () => s.colour));
  const belt = rank.secondaryColour
    ? `linear-gradient(to bottom, ${rank.primaryColour} 50%, ${rank.secondaryColour} 50%)`
    : rank.primaryColour;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        width: 72,
        height: 16,
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
          minWidth: 18,
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
