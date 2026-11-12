import React, { type ReactNode } from 'react';
import { Spinner, SuccessPanel } from '@ultm8/ui';
import './signIn.css';

/**
 * The new look's frame for the pages outside the app shell (Decision 453,
 * Decision 460): Log in, Create account, Verify phone, Forgot / Reset
 * passcode, First-login passcode, Accept the Terms, the coach invite link and
 * the guest waiver link. It replaces `AuthCard` on these pages only (the
 * Platform Admin app still uses `AuthCard`).
 *
 * The approved design draws no sign-in screen, so this is built from the new
 * look's own pieces: the brand mark as the side menu shows it (a small
 * rounded tile), a white card on the grey page, the soft fields and pill
 * buttons every form already has. Look only: the pages' fields, ids,
 * autocomplete attributes, links, wording and API calls are unchanged.
 */
function Brand({ tagline }: { tagline?: string }) {
  return (
    <div className="u8si-brand">
      <span className="u8si-brand__mark" aria-hidden="true">
        U8
      </span>
      <div className="u8si-brand__copy">
        <span className="u8si-brand__name">ULTM8</span>
        {tagline ? <span className="u8si-brand__tagline">{tagline}</span> : null}
      </div>
    </div>
  );
}

function SignInPage({ wide, tagline, children }: { wide?: boolean; tagline?: string; children: ReactNode }) {
  return (
    <div className="u8si-page">
      <div className={'u8si-column' + (wide ? ' u8si-column--wide' : '')}>
        <Brand tagline={tagline} />
        {children}
      </div>
    </div>
  );
}

export function SignInCard({
  title,
  subtitle,
  footer,
  tagline,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  /** A line under the card (e.g. "New here? Create an account"). */
  footer?: ReactNode;
  /** A line under the brand name (Log in only). */
  tagline?: string;
  /** For the longer pages: Create account and the guest waiver. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <SignInPage wide={wide} tagline={tagline}>
      <section className="u8si-card" data-testid="sign-in-card">
        <h1 className="u8si-card__title">{title}</h1>
        {subtitle ? <p className="u8si-card__subtitle">{subtitle}</p> : null}
        {children}
      </section>
      {footer ? <div className="u8si-footer">{footer}</div> : null}
    </SignInPage>
  );
}

/** The same frame holding the success panel, after Log in, Create account
 * and Reset passcode (it replaces `AuthSuccessCard` on these pages). */
export function SignInSuccessCard({ title, subtitle, onContinue }: { title: string; subtitle?: string; onContinue: () => void }) {
  return (
    <SignInPage>
      <section className="u8si-card u8si-card--success" data-testid="sign-in-card">
        <SuccessPanel title={title} subtitle={subtitle} onContinue={onContinue} />
      </section>
    </SignInPage>
  );
}

/** While a link (coach invite, guest waiver) is being looked up. */
export function SignInLoading() {
  return (
    <SignInPage>
      <div className="u8si-loading">
        <Spinner />
      </div>
    </SignInPage>
  );
}
