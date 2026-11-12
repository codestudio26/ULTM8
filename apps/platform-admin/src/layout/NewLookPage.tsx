import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Page layout pieces for the new look, the School Portal's own
 * (apps/school-portal/src/layout/NewLookPage.tsx), for Platform Admin's pages.
 * Their styles are in adminShell.css, under `data-look="redesign"`.
 */

/** A white page header: an optional "‹ Parent" link, the title (30px light),
 * a grey subtitle, actions on the right and the page's tabs (3px underline). */
export function NewLookPageHeader({
  title,
  subtitle,
  parent,
  actions,
  tabs,
  tabsLabel,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  parent?: { to: string; label: string };
  actions?: React.ReactNode;
  tabs?: Array<{ to: string; label: string; current?: boolean }>;
  tabsLabel?: string;
}) {
  return (
    <header className="u8n-page-header">
      {parent ? (
        <Link to={parent.to} className="u8n-page-header__parent">
          <span aria-hidden="true">‹ </span>
          {parent.label}
        </Link>
      ) : null}
      <div className="u8n-page-header__row">
        <div style={{ minWidth: 0 }}>
          <h1 className="u8n-page-header__title">{title}</h1>
          {subtitle ? <p className="u8n-page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="u8n-page-header__actions">{actions}</div> : null}
      </div>
      {tabs?.length ? (
        <nav className="u8n-tabs u8n-tabs--page" aria-label={tabsLabel}>
          {tabs.map((tab) => (
            <Link key={tab.to} to={tab.to} className={'u8n-tab' + (tab.current ? ' u8n-tab--active' : '')} aria-current={tab.current ? 'page' : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

/** The page body with an optional 340px right inspector (the selected record,
 * a summary, a preview or alerts). Without `inspector` it is just the body.
 * On narrower screens the inspector moves below the page (DESIGN.md → "Phone
 * layout"), and its buttons sit straight under its content. */
export function NewLookPage({
  children,
  inspector,
  inspectorLabel,
}: {
  children: React.ReactNode;
  inspector?: React.ReactNode;
  /** The inspector's first line, a small grey uppercase label, and its name. */
  inspectorLabel?: string;
}) {
  if (!inspector) return <div className="u8n-page">{children}</div>;
  return (
    <div className="u8n-page u8n-page--with-inspector">
      <div className="u8n-page__body">{children}</div>
      <aside className="u8n-inspector" aria-label={inspectorLabel}>
        {inspectorLabel ? (
          <p className="u8n-inspector__label" aria-hidden="true">
            {inspectorLabel}
          </p>
        ) : null}
        {inspector}
      </aside>
    </div>
  );
}
