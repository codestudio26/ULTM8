import React, { forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { NavLink } from 'react-router-dom';

/* ---------------------------------------------------------------------- Button */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
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
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="ultm8-field">
      <label className="ultm8-field__label" htmlFor={htmlFor}>
        {label}
      </label>
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
    // Scrolls horizontally within itself on a narrow viewport instead of forcing the
    // whole page (sidebar included) to scroll sideways — a table wider than the
    // viewport previously had no containing overflow anywhere in its ancestry.
    <div className="ultm8-table-wrap">
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
  children,
}: {
  brand: string;
  navItems: NavItem[];
  footer?: ReactNode;
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
      <main className="ultm8-shell__main">{children}</main>
    </div>
  );
}

/* ---------------------------------------------------------------------- Auth card layout */

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="ultm8-auth-page">
      <div className="ultm8-auth-card">
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
