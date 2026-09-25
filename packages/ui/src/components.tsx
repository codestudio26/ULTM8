import React, { forwardRef, useEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { NavLink } from 'react-router-dom';

/* ---------------------------------------------------------------------- Button */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  fullWidth?: boolean;
  loading?: boolean;
}

export function Button({ variant = 'primary', fullWidth, loading, disabled, children, className, ...rest }: ButtonProps) {
  const classes = ['ultm8-btn', `ultm8-btn--${variant}`, fullWidth ? 'ultm8-btn--full' : '', className ?? ''].join(' ').trim();
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------- Field wrapper */

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  /** Optional inline element rendered alongside the label (e.g. a "Forgot your
   * passcode?" link) — same row, opposite end. */
  labelAction?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, labelAction, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="ultm8-field">
      <div className="ultm8-field__label-row">
        <label className="ultm8-field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {labelAction}
      </div>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            id: htmlFor,
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
          })
        : children}
      {hint && !error ? (
        <span className="ultm8-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ultm8-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- Inputs */

export const TextField = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} className="ultm8-input" {...props} />
));
TextField.displayName = 'TextField';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => (
  <textarea ref={ref} className="ultm8-input" {...props} />
));
TextArea.displayName = 'TextArea';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(({ options, ...rest }, ref) => (
  <select ref={ref} className="ultm8-select" {...rest}>
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
));
SelectField.displayName = 'SelectField';

function EyeIcon() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <path
        d="M1 7C1 7 4.5 1.5 10 1.5C15.5 1.5 19 7 19 7C19 7 15.5 12.5 10 12.5C4.5 12.5 1 7 1 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="10" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <path
        d="M1 7C1 7 4.5 1.5 10 1.5C15.5 1.5 19 7 19 7C19 7 15.5 12.5 10 12.5C4.5 12.5 1 7 1 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line x1="2" y1="12" x2="18" y2="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** A passcode/password input with a show/hide toggle — same `ultm8-input` look and
 * the same props surface as `TextField`, so it drops in wherever a masked field is
 * used today. */
export const PasscodeField = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="ultm8-passcode-field">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={['ultm8-input', className ?? ''].join(' ').trim()}
          {...rest}
        />
        <button
          type="button"
          className="ultm8-passcode-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide passcode' : 'Show passcode'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);
PasscodeField.displayName = 'PasscodeField';

export interface SegmentedCodeInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Number of digit boxes. Defaults to 6 — matches this app's own passcode length
   * and Twilio Verify's typical default, but the real OTP length isn't confirmed by
   * the backend (`VerifyOtpDto.code` only validates `@Length(4, 8)`) — flagged as an
   * assumption, not a confirmed value. */
  length?: number;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Applied to every box, so the browser blocks submission until all are filled —
   * matches (and improves on) the plain-text field's own `required`, which only
   * checked "not empty," not "exactly `length` digits." */
  required?: boolean;
}

/** A 6-box (by default) digit input for OTP/verification codes, matching the
 * approved Figma-reference design. Single control: `value`/`onChange` carry the
 * concatenated digit string, same shape a plain text `code` field would.
 *
 * `id`/`aria-invalid`/`aria-describedby` (as `Field` clones onto a single child)
 * land on the FIRST box, not the outer group `<div>` — a `<label htmlFor>` can
 * only associate with a labelable control, and a `role="group"` div isn't one; the
 * previous plain `<input>` was directly labelable, so anchoring to box 0 keeps
 * "click the label to focus the field" and the screen-reader name/error working. */
export function SegmentedCodeInput({
  length = 6,
  value,
  onChange,
  autoFocus,
  required,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SegmentedCodeInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      // Clearing an already-filled box — drop it and everything after, same as a
      // plain text field losing its tail; a string has no way to represent "blank
      // here, digits after" without a placeholder character.
      if (index < value.length) onChange(value.slice(0, index));
      return;
    }
    const digit = raw[raw.length - 1];
    if (index < value.length) {
      // Editing an already-filled digit in place — keep every other position.
      const next = value.slice(0, index) + digit + value.slice(index + 1);
      onChange(next);
      if (index < length - 1) inputsRef.current[index + 1]?.focus();
      return;
    }
    // Typing into a box ahead of the current end (e.g. clicked a later empty box
    // directly, not reached via auto-advance). The digit lands at the true next
    // slot, not at `index` — `chars[index] = digit; chars.join('')` would silently
    // collapse the gap (array holes join as '', losing position), corrupting which
    // digit ends up where. Landing it at the real next slot and refocusing there
    // keeps state correct and is self-correcting for the user.
    const next = (value + digit).slice(0, length);
    onChange(next);
    if (next.length < length) inputsRef.current[next.length]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Backspace') return;
    // Handled explicitly rather than left to the native input: with `maxLength={1}`,
    // where the browser places the cursor inside an already-filled box is ambiguous
    // (before or after the one character, depending on click position) — Backspace
    // can silently do nothing if the cursor lands before it. Owning the behavior
    // here makes it deterministic: clear this box and stay, or if already empty,
    // clear the previous box and move focus there — the standard OTP-input pattern.
    e.preventDefault();
    if (value[index]) {
      onChange(value.slice(0, index) + value.slice(index + 1));
    } else if (index > 0) {
      onChange(value.slice(0, index - 1) + value.slice(index));
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    e.preventDefault();
    onChange(digits);
    inputsRef.current[Math.min(digits.length, length - 1)]?.focus();
  }

  return (
    <div className="ultm8-segmented-code" role="group" {...rest}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          aria-invalid={i === 0 ? ariaInvalid : undefined}
          aria-describedby={i === 0 ? ariaDescribedBy : undefined}
          required={required}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          className="ultm8-segmented-code__box"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          onPaste={handlePaste}
          autoFocus={autoFocus && i === 0}
        />
      ))}
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ultm8-checkbox">
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

/* ---------------------------------------------------------------------- Layout */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ultm8-card', className ?? ''].join(' ').trim()}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="ultm8-page-header">
      <div>
        <h1 className="ultm8-page-header__title">{title}</h1>
        {subtitle ? <p className="ultm8-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/* ---------------------------------------------------------------------- Table */

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function Table<T extends { id: string }>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  return (
    // Scrolls horizontally within itself rather than letting a wide table push the
    // page wider (DESIGN.md "Layout & spacing": no horizontal overflow at any
    // breakpoint — this is the one place in this component set a table's natural
    // column count can realistically exceed a phone viewport).
    <div className="ultm8-table-scroll">
      <table className="ultm8-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------- Feedback */

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'accent' | 'success' | 'danger' }) {
  const cls = variant === 'default' ? 'ultm8-badge' : `ultm8-badge ultm8-badge--${variant}`;
  return <span className={cls}>{children}</span>;
}

export function Spinner() {
  return <span className="ultm8-spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="ultm8-state">
      <p className="ultm8-state__title">{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="ultm8-banner ultm8-banner--error" role="alert">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="ultm8-banner ultm8-banner--success" role="status">
      {message}
    </div>
  );
}

/* ---------------------------------------------------------------------- App shell */

export interface NavItem {
  label: string;
  to: string;
}

export function AppShell({
  brand,
  navItems,
  footer,
  header,
  children,
}: {
  brand: string;
  navItems: NavItem[];
  footer?: ReactNode;
  /** Optional app-shell header, rendered once at the top of the main content
   * column (above every page's own content) — opt-in so an app that doesn't
   * pass it (e.g. platform-admin's Shell today) renders exactly as before. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ultm8-shell">
      <aside className="ultm8-shell__sidebar">
        <p className="ultm8-shell__brand">{brand}</p>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => 'ultm8-shell__nav-link' + (isActive ? ' ultm8-shell__nav-link--active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {footer ? <div className="ultm8-shell__footer-action">{footer}</div> : null}
      </aside>
      <main className="ultm8-shell__main">
        {header ? <div className="ultm8-shell__topbar">{header}</div> : null}
        {children}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- Auth card layout */

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  rail,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional banner rendered above the card, inside the same centered column —
   * currently only Login's brand rail uses this. */
  rail?: ReactNode;
}) {
  return (
    <div className="ultm8-auth-page">
      <div className="ultm8-auth-card">
        {rail}
        <Card>
          <h1 className="ultm8-auth-card__title">{title}</h1>
          {subtitle ? <p className="ultm8-auth-card__subtitle">{subtitle}</p> : null}
          {children}
        </Card>
        {footer ? <div className="ultm8-auth-card__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Checkmark / title / subtitle / dismiss (×) confirmation panel — the pattern
 * DESIGN.md's "Success confirmation panel" section documents, now built for real.
 * Auto-advances via `onContinue` after `autoAdvanceMs`, but the dismiss button or a
 * `secondaryAction` (if given) let the user skip the wait immediately. */
export function SuccessPanel({
  title,
  subtitle,
  onContinue,
  autoAdvanceMs = 2000,
}: {
  title: string;
  subtitle?: string;
  onContinue: () => void;
  autoAdvanceMs?: number;
}) {
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    const timer = setTimeout(() => onContinueRef.current(), autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [autoAdvanceMs]);

  return (
    <div className="ultm8-success-panel">
      <button type="button" className="ultm8-success-panel__dismiss" aria-label="Dismiss" onClick={onContinue}>
        &times;
      </button>
      <div className="ultm8-success-panel__check" aria-hidden="true">
        ✓
      </div>
      <p className="ultm8-success-panel__title">{title}</p>
      {subtitle ? <p className="ultm8-success-panel__subtitle">{subtitle}</p> : null}
    </div>
  );
}

/** The same centered auth-page/card chrome as `AuthCard`, holding a `SuccessPanel`
 * instead of a form — for the post-Login/Register/Reset confirmation screen. */
export function AuthSuccessCard({
  title,
  subtitle,
  onContinue,
  autoAdvanceMs,
}: {
  title: string;
  subtitle?: string;
  onContinue: () => void;
  autoAdvanceMs?: number;
}) {
  return (
    <div className="ultm8-auth-page">
      <div className="ultm8-auth-card">
        <Card>
          <SuccessPanel title={title} subtitle={subtitle} onContinue={onContinue} autoAdvanceMs={autoAdvanceMs} />
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Modal */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="ultm8-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="ultm8-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ultm8-page-header__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
