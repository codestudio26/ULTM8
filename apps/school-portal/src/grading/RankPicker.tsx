import React, { useEffect, useRef, useState } from 'react';
import { BeltChip } from './BeltChip';
import type { Rung } from './ladder';

/**
 * Our own drop-down of ranks, never the browser's `<select>` (DESIGN.md →
 * "Drop-downs" and "Promote selected: pick the rank"): a soft grey field with
 * the belt picture, the rank name and a chevron; the list opens under it and
 * pushes the content down, each option with its belt picture; the chosen one
 * is pale green with a ✓. `role="combobox"` + `role="listbox"`/`"option"`.
 * The options are built only while the list is open, so a long ladder (or a
 * board of 400 students) stays quick. `id` lets a `<Field htmlFor>` label it.
 */
export function RankPicker({
  id,
  options,
  value,
  onChange,
  suffix,
  heading,
  ariaLabel,
}: {
  id: string;
  options: Rung[];
  value: string;
  onChange: (rungId: string) => void;
  /** Extra text after an option's name, e.g. "· Adult program". */
  suffix?: (rung: Rung) => string | null;
  /** A small grey heading shown above this option, e.g. "ADULT PROGRAM" (backlog 3.20). */
  heading?: (rung: Rung) => string | null;
  /** A name for the field when no `<Field htmlFor>` labels it, e.g. in a list row. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const chosen = options.find((r) => r.id === value) ?? null;
  const listId = `${id}-list`;
  // Sized from the longest name, so it doesn't jump when the value changes.
  const longest = options.reduce((n, r) => Math.max(n, r.name.length + (suffix?.(r)?.length ?? 0)), 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function openList() {
    setActive(Math.max(0, options.findIndex((r) => r.id === value)));
    setOpen(true);
  }

  function pick(rung: Rung) {
    onChange(rung.id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    }
  }

  const label = (r: Rung) => {
    const extra = suffix?.(r);
    return extra ? `${r.name} ${extra}` : r.name;
  };

  return (
    <div ref={root} className="ultm8-rank-picker" style={{ maxWidth: '100%', width: `calc(${longest}ch + 140px)` }}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        className={`ultm8-rank-picker__field${open ? ' ultm8-rank-picker__field--open' : ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        {chosen ? <BeltChip rung={chosen} /> : null}
        <span className="ultm8-rank-picker__value">{chosen ? label(chosen) : ''}</span>
        <span aria-hidden="true" className="ultm8-rank-picker__chevron">
          ▾
        </span>
      </button>
      {open ? (
        <ul id={listId} ref={listRef} role="listbox" aria-labelledby={ariaLabel ? undefined : id} aria-label={ariaLabel} className="ultm8-rank-picker__list">
          {options.map((r, i) => {
            const selected = r.id === value;
            const title = heading?.(r);
            return (
              <React.Fragment key={r.id}>
              {title ? (
                <li role="presentation" className="ultm8-rank-picker__heading">
                  {title}
                </li>
              ) : null}
              <li
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={selected}
                className={[
                  'ultm8-rank-picker__option',
                  selected ? 'ultm8-rank-picker__option--selected' : '',
                  i === active ? 'ultm8-rank-picker__option--active' : '',
                ]
                  .join(' ')
                  .trim()}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
              >
                <BeltChip rung={r} />
                <span style={{ flex: 1 }}>{label(r)}</span>
                {selected ? <span aria-hidden="true">✓</span> : null}
              </li>
              </React.Fragment>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
