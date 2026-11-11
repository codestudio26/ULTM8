import React, { useEffect, useRef, useState } from 'react';

export interface TeamSelectOption {
  value: string;
  label: string;
}

/**
 * The Team pages' own drop-down (DESIGN.md → "Drop-downs"), never a browser
 * `<select>`: a soft grey field with the value and a chevron, exactly as wide
 * as its longest option, and a list that opens under it and pushes the
 * content down. Built as the ARIA select-only combobox: a `combobox` button
 * named by its label, with a `listbox` of `option`s. The same as the Students
 * list's, kept in the Team files until one shared copy lands.
 */
export function TeamSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: TeamSelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const labelId = `${id}-label`;
  const listId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const show = () => {
    setActive(selectedIndex);
    setOpen(true);
  };
  const pick = (i: number) => {
    setOpen(false);
    if (options[i] && options[i].value !== value) onChange(options[i].value);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="u8t-select" ref={rootRef}>
      <span className="u8t-select__label" id={labelId}>
        {label}
      </span>
      <button
        id={id}
        type="button"
        role="combobox"
        className="u8t-select__field"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {/* Every option sits in the same grid cell, only the chosen one
            visible, so the field is as wide as the longest and never jumps. */}
        <span className="u8t-select__values">
          {options.map((o, i) => (
            <span key={o.value} className="u8t-select__value" aria-hidden={i === selectedIndex ? undefined : true} data-shown={i === selectedIndex}>
              {o.label}
            </span>
          ))}
        </span>
        <svg className="u8t-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="u8t-select__list" role="listbox" id={listId} aria-labelledby={labelId}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              className={'u8t-select__option' + (i === active ? ' u8t-select__option--active' : '')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
            >
              <span>{o.label}</span>
              {i === selectedIndex ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
