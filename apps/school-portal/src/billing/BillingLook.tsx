import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/I18nProvider';
import './billingLook.css';

/**
 * The Billing pages' pieces in the new look (Decision 453; DESIGN-BRIEF §8
 * "Template rules"; DESIGN.md → "Phone layout", "Stat rows", "Drop-downs",
 * "One accent: mint", "Button pairs"): Membership plans, Transactions,
 * Billing reports and Payroll. Layout and styling only; each page keeps its
 * own data, filters, actions and permission checks. The page header and the
 * shell come from `layout/NewLookPage.tsx`; these pieces sit under it.
 * Everything is styled in billingLook.css, scoped to `[data-look='redesign']`.
 */

/** The page's root: scopes the Billing card, table and pill styles. */
export function BillingPage({ children }: { children: React.ReactNode }) {
  return <div className="u8b">{children}</div>;
}

/** The page header with the page's own tabs (Overview / Member balances,
 * Report / Rates) inside the same white band, under the title. The tabs
 * switch what the page shows, as before; they are not separate addresses. */
export function BillingHead({
  header,
  tabs,
  value,
  onChange,
  label,
}: {
  header: React.ReactNode;
  tabs?: Array<{ id: string; label: string }>;
  value?: string;
  onChange?: (id: string) => void;
  label?: string;
}) {
  if (!tabs?.length) return <>{header}</>;
  return (
    <div className="u8b-head">
      {header}
      <div role="tablist" aria-label={label} className="u8b-head__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            className={'u8b-tab' + (tab.id === value ? ' u8b-tab--active' : '')}
            onClick={() => onChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A white card. `title` is its 18px heading; `toolbar` sits at the top. */
export function BillingCard({
  title,
  toolbar,
  children,
  testId,
  flush,
}: {
  title?: React.ReactNode;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  /** No inner padding: a table runs edge to edge. */
  flush?: boolean;
}) {
  return (
    <section className={'u8b-card' + (flush ? ' u8b-card--flush' : '')} data-testid={testId}>
      {title ? <h2 className="u8b-card__title">{title}</h2> : null}
      {toolbar ? <div className="u8b-toolbar">{toolbar}</div> : null}
      {children}
    </section>
  );
}

/** A stat row (DESIGN.md → "Stat rows"): equal columns, each label in the
 * same fixed-height slot so the numbers line up, the number under it and an
 * optional grey line under that. */
export function BillingStats({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="u8b-stats" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function BillingStat({
  label,
  value,
  hint,
  testId,
  danger,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  testId?: string;
  danger?: boolean;
}) {
  // The label then the value, each its own <span>, as before: the tests read
  // a tile as "label value" and its value as the second span.
  return (
    <div className="u8b-stat" data-testid={testId}>
      <span className="u8b-stat__label">{label}</span>
      <span className={'u8b-stat__num' + (danger ? ' u8b-stat__num--danger' : '')}>{value}</span>
      {hint ? <span className="u8b-stat__hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Secondary actions (Export CSV, Download CSV). On a computer and a tablet
 * they stay in view; on a phone they move under a "⋯" More button and open
 * as a small stacked list (DESIGN.md → "Phone layout", Toolbars). Each action
 * is rendered once, so nothing is shown twice.
 */
export function BillingMore({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="u8b-more" ref={rootRef} data-open={open}>
      <button
        type="button"
        className="u8b-pill u8b-more__button"
        aria-expanded={open}
        aria-label={t('transactions.moreActions')}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div className="u8b-more__items">{children}</div>
    </div>
  );
}

export interface BillingSelectOption {
  value: string;
  label: string;
}

/**
 * The new look's own drop-down (DESIGN.md → "Drop-downs"), never a browser
 * `<select>`: a soft grey field with the value and a chevron, as wide as its
 * longest option, and a list that opens under it and pushes the content
 * down. The ARIA select-only combobox: a `combobox` button named by its
 * label, with a `listbox` of `option`s. Picking an option calls `onChange`
 * with its value, exactly as the `<select>` it replaces did.
 */
export function BillingSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: BillingSelectOption[];
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
    <div className="u8b-select" ref={rootRef}>
      <span className="u8b-select__label" id={labelId}>
        {label}
      </span>
      <button
        id={id}
        type="button"
        role="combobox"
        className="u8b-select__field"
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
        <span className="u8b-select__values">
          {options.map((o, i) => (
            <span key={o.value} className="u8b-select__value" aria-hidden={i === selectedIndex ? undefined : true} data-shown={i === selectedIndex}>
              {o.label}
            </span>
          ))}
        </span>
        <svg className="u8b-select__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="u8b-select__list" role="listbox" id={listId} aria-labelledby={labelId}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === selectedIndex}
              className={'u8b-select__option' + (i === active ? ' u8b-select__option--active' : '')}
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

/** A date field in the toolbar: the same soft grey look as the drop-downs. */
export function BillingDate({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="u8b-select">
      <label className="u8b-select__label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="date" className="u8b-date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
