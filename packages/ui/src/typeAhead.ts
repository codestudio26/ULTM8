import { useCallback, useRef } from 'react';

/** Keys typed within this long of each other make one word ("ma" → "Mark"). */
const TYPE_AHEAD_PAUSE_MS = 500;

/**
 * Where a drop-down's highlight goes when a letter is typed (Decision 462
 * item 7), as a browser `<select>` did and as the ARIA select-only combobox
 * pattern describes: the next option starting with that letter, the same
 * letter again cycles through them, and several letters typed quickly match
 * the start of a whole name. Matching ignores case.
 *
 * `typed` is everything typed so far (lower-cased), `current` the highlighted
 * option (-1 for none). Returns the option to highlight, or -1 when none
 * matches (the highlight then stays where it is).
 */
export function typeAheadMatch(labels: readonly string[], typed: string, current: number): number {
  if (!typed || labels.length === 0) return -1;
  const chars = [...typed];
  const sameLetter = chars.every((c) => c === chars[0]);
  // One letter (or the same one repeated) moves on from the current option;
  // a longer word may stay on it while it still matches.
  const query = sameLetter ? chars[0] : typed;
  const start = sameLetter ? current + 1 : Math.max(current, 0);
  for (let k = 0; k < labels.length; k += 1) {
    const i = (((start + k) % labels.length) + labels.length) % labels.length;
    if (labels[i].trim().toLocaleLowerCase().startsWith(query)) return i;
  }
  return -1;
}

/**
 * The drop-downs' type-ahead: call the returned function from the field's
 * `keydown`. It returns `null` when the key isn't type-ahead (arrows, Enter,
 * Tab, a shortcut, or Space with nothing typed, which still opens or picks),
 * otherwise the option to highlight (-1: no match). The caller then stops the
 * key's default and opens the list if it was shut.
 */
export function useTypeAhead() {
  const typed = useRef('');
  const lastAt = useRef(0);
  return useCallback(
    (e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, labels: readonly string[], current: number): number | null => {
      if (e.ctrlKey || e.metaKey || e.altKey) return null;
      // A printable character is one character long; named keys ("Enter") aren't.
      if ([...e.key].length !== 1) return null;
      const now = Date.now();
      const sofar = now - lastAt.current < TYPE_AHEAD_PAUSE_MS ? typed.current : '';
      if (e.key === ' ' && !sofar) return null;
      typed.current = sofar + e.key.toLocaleLowerCase();
      lastAt.current = now;
      return typeAheadMatch(labels, typed.current, current);
    },
    [],
  );
}
