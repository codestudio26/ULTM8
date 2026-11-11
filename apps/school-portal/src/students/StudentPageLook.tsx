import React, { useId } from 'react';
import './studentsList.css';
import './studentPage.css';

/**
 * Pieces of the student's full page in the new look (Decision 453;
 * DESIGN-BRIEF §8 "Student profile"; DESIGN.md → "Student page: nothing
 * shown twice"). Layout and styling only: each card keeps its own data,
 * actions and permission checks. Styled in studentPage.css, scoped to
 * `.u8sp` (the page's root) under `[data-look='redesign']`.
 */

/** The page's root: scopes the card, field, tag and button styles, the
 * dialogs opened from the page included. */
export function StudentPageRoot({ children }: { children: React.ReactNode }) {
  return <div className="u8sp">{children}</div>;
}

/**
 * A white card with a light header bar (DESIGN-BRIEF §8: "the dark card
 * headers are now light"): the title on the left, the card's own actions
 * on the right, then the body. The card is a region named by its title.
 */
export function StudentCard({
  title,
  titleExtra,
  actions,
  children,
  testId,
  id,
  label,
  variant,
}: {
  title: React.ReactNode;
  /** Shown after the title, e.g. an "Archived" tag. */
  titleExtra?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  id?: string;
  /** The region's name, when it isn't the title's text. */
  label?: string;
  /** `style`: a style's Ranks card, with its larger title. */
  variant?: 'style';
}) {
  const titleId = useId();
  return (
    <section
      className={'u8sp-card' + (variant ? ` u8sp-card--${variant}` : '')}
      id={id}
      data-testid={testId}
      aria-label={label}
      aria-labelledby={label ? undefined : titleId}
    >
      <div className="u8sp-card__bar">
        <h2 className="u8sp-card__title" id={titleId}>
          {title}
          {titleExtra}
        </h2>
        {actions ? <div className="u8sp-card__actions">{actions}</div> : null}
      </div>
      {children !== undefined && children !== null && children !== false ? <div className="u8sp-card__body">{children}</div> : null}
    </section>
  );
}

/** A heading and its rows in the summary panel (Contact, Personal, …). */
export function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="u8n-student-panel__heading">{children}</h3>;
}

/** One "label · value" row in the summary panel. */
export function PanelRow({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <div className="u8n-student-panel__row">
      <span>{label}</span>
      <span data-testid={testId}>{children}</span>
    </div>
  );
}
