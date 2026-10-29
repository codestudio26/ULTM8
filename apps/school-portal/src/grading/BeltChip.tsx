import React from 'react';
import type { Rung } from './ladder';
import { textOn } from '../ranks/colour';

type Segment = { count: number; colour: string };

/** A small belt picture for a rung: the belt's colour, and the tag with this
 * rung's stripes. A two-tone belt has its second colour as a band through the
 * middle 30%, like a real Grey/White kids' belt (DESIGN.md → "Belt picture").
 * Colours are the school's own free text; an unknown one simply doesn't paint
 * (CSS ignores it), as on the Disciplines page. Decorative: the rung name is
 * always shown next to it. `large` is the 168 × 30 picture in a panel. */
export function BeltChip({ rung, large = false, step }: { rung: Rung; large?: boolean; step?: { n: number; of: number } }) {
  const { rank, tier } = rung;
  if (rank.rankDisplay === 'LEVELS') {
    const tiers = [...rank.stripeTiers].sort((a, b) => a.order - b.order);
    const at = step ?? { n: tiers.findIndex((x) => x.id === tier.id) + 1 || 1, of: Math.max(tiers.length, 1) };
    return <LevelBadge colour={rank.primaryColour} step={at.n} steps={at.of} large={large} />;
  }
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

/** A level (Decision 290, DESIGN.md → "Ranks without a belt"): a rounded tag
 * in the School's colour with a dot per step, filled up to this one ("●●○" is
 * step 2 of 3). Same sizes as the belt picture; the dots are dark or white to
 * suit the colour. Decorative like the belt: the step's name sits next to it. */
export function LevelBadge({ colour, step, steps, large = false }: { colour: string; step: number; steps: number; large?: boolean }) {
  const dot = large ? 8 : 5;
  const ink = textOn(colour);
  return (
    <span
      aria-hidden="true"
      data-level-step={`${step}/${steps}`}
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        gap: large ? 5 : 3,
        width: large ? 168 : 72,
        height: large ? 30 : 16,
        borderRadius: large ? 15 : 8,
        border: '1px solid var(--border-strong)',
        background: colour,
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: Math.min(steps, large ? 12 : 8) }, (_, i) => (
        <span
          key={i}
          style={{ width: dot, height: dot, borderRadius: '50%', boxSizing: 'border-box', border: `1px solid ${ink}`, background: i < step ? ink : 'transparent' }}
        />
      ))}
    </span>
  );
}
