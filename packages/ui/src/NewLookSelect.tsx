import React, { useEffect, useRef, useState } from 'react';

export interface NewLookSelectOption {
  value: string;
  label: string;
}

/**
 * The new look's own drop-down (DESIGN.md → "Drop-downs"), never a browser
 * `<select>`: a soft grey field with the value and a chevron, exactly as wide
 * as its longest option, and a list that opens under it and pushes the
 * content down. Built as the ARIA select-only combobox: a `combobox` button
 * named by its label, with a `listbox` of `option`s.
 *
 * Its styles are the School Portal's (`layout/newLookShell.css`, under
 * [data-look='redesign']); it lives in this package so shared form parts
 * such as `AddressFields` can use it.
 */
export function NewLookSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: {
  id: string;
  label: string;
  value: string;
  options: NewLookSelectOption[];
  onChange: (value: string) => void;
  /** While a change is saving: the field can't be opened. */
  disabled?: boolean;
  /** A fuller name for screen readers than the visible label. */
  ariaLabel?: string;
  /** Set when the field has an error, which `aria-describedby` points at. */
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-describedby'?: string;
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
    if (options[i] && options[i].value !== value) {
      onChange(options[i].value);
      // A pick counts as an edit, as a browser <select>'s change did (it
      // fired an `input` event): a dialog's unsaved-changes guard (Modal)
      // then keeps it open on an outside click or Escape.
      rootRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
    }
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
    <div className="u8n-select" ref={rootRef}>
      <span className="u8n-select__label" id={labelId}>
        {label}
      </span>
      <button
        id={id}
        type="button"
        role="combobox"
        className="u8n-select__field"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={ariaLabel ? undefined : labelId}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        {/* Every option sits in the same grid cell, only the chosen one
            visible, so the field is as wide as the longest and never jumps. */}
        <span className="u8n-select__values">
          {options.map((o, i) => (
            <span key={o.value} className="u8n-select__value" aria-hidden={i === selectedIndex ? undefined : true} data-shown={i === selectedIndex}>
              {o.label}
            </span>
          ))}
        </span>
        <svg className="u8n-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="u8n-select__list" role="listbox" id={listId} aria-labelledby={labelId}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              className={'u8n-select__option' + (i === active ? ' u8n-select__option--active' : '')}
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
