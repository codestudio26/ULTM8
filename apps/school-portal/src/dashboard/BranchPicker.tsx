import React, { useEffect, useRef, useState } from 'react';
import { useBranches } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 367 (Q5) — the Dashboard's Branch filter in the new look: our own
 * drop-down, never the browser's `<select>` (DESIGN.md → "Drop-downs"). The
 * same rule as BranchFilter: shown only when the School has two or more open
 * Branches; "All Branches" (the default) also counts School-wide Classes with
 * no Branch. It reuses the Rank picker's drop-down styles (soft grey field,
 * the list opens under it, the chosen option pale green with a ✓).
 * `role="combobox"` + `role="listbox"`/`"option"`.
 */
export function useBranchChoices(schoolId: string, value: string) {
  const t = useT();
  const { data } = useBranches(schoolId);
  const open = (data?.items ?? []).filter((b) => !b.archivedAt);
  const options = [{ id: '', name: t('dashboard.branchAll') }, ...open.map((b) => ({ id: b.id, name: b.name }))];
  return { options, offered: open.length >= 2 || !!value };
}

export function BranchPicker({ options, value, onChange }: { options: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const id = 'dashboard-branch-filter';
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const chosen = options.find((o) => o.id === value) ?? options[0];
  // Sized from the longest name, so it doesn't jump when the value changes.
  const longest = options.reduce((n, o) => Math.max(n, o.name.length), 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function openList() {
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(true);
  }

  function pick(optionId: string) {
    onChange(optionId);
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
      if (options[active]) pick(options[active].id);
    }
  }

  return (
    <div ref={root} className="ultm8-rank-picker u8n-dash-branch" style={{ maxWidth: '100%', width: `calc(${longest}ch + 64px)` }}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={t('dashboard.branchLabel')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        className={`ultm8-rank-picker__field${open ? ' ultm8-rank-picker__field--open' : ''}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="ultm8-rank-picker__value">{chosen?.name}</span>
        <span aria-hidden="true" className="ultm8-rank-picker__chevron">
          ▾
        </span>
      </button>
      {open ? (
        <ul id={listId} role="listbox" aria-label={t('dashboard.branchLabel')} className="ultm8-rank-picker__list">
          {options.map((o, i) => {
            const selected = o.id === value;
            return (
              <li
                key={o.id || 'all'}
                id={`${id}-opt-${i}`}
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
                onClick={() => pick(o.id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{o.name}</span>
                {selected ? <span aria-hidden="true">✓</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
