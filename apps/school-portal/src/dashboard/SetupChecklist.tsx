import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@ultm8/ui';
import './dashboardPage.css';
import { useSetSetupChecklistHidden, type DashboardOverview, type SetupStepKey } from './dashboardQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { STRIPE_CONNECT_ANCHOR } from '../schools/StripeConnectCard';
import { useOffersPix } from '../lib/deskMethods';

/** Where each step is done. Stripe is connected from the Stripe card on the
 * School page (Decision 441 item 6). */
const STEPS: Record<SetupStepKey, { label: TranslationKey; to: string | null }> = {
  BRANCH: { label: 'dashboard.setup.steps.BRANCH', to: '/branches' },
  STYLE_AND_BELTS: { label: 'dashboard.setup.steps.STYLE_AND_BELTS', to: '/disciplines' },
  CLASS: { label: 'dashboard.setup.steps.CLASS', to: '/timetable' },
  MEMBERSHIP_PLAN: { label: 'dashboard.setup.steps.MEMBERSHIP_PLAN', to: '/membership-plans' },
  WAIVER: { label: 'dashboard.setup.steps.WAIVER', to: '/waivers' },
  STRIPE: { label: 'dashboard.setup.steps.STRIPE', to: `/school#${STRIPE_CONNECT_ANCHOR}` },
  STAFF: { label: 'dashboard.setup.steps.STAFF', to: '/staff' },
};

/**
 * Decision 374 (Decision 318 item 1) — the owner's setup checklist: each step
 * ticks itself once the School has it. The owner can hide it, and bring it
 * back from the link left in its place.
 */
export function SetupChecklist({ schoolId, checklist }: { schoolId: string; checklist: DashboardOverview['setupChecklist'] }) {
  const t = useT();
  const setHidden = useSetSetupChecklistHidden(schoolId);
  // Decision 448 item 5: Pix is named only for a School in Brazil.
  const pix = useOffersPix(schoolId);
  if (checklist.hidden) {
    return (
      <p className="u8n-dash-setup__show">
        <Button variant="secondary" onClick={() => setHidden.mutate(false)} disabled={setHidden.isPending}>
          {t('dashboard.setup.show')}
        </Button>
      </p>
    );
  }
  const done = checklist.steps.filter((s) => s.done).length;
  const allDone = done === checklist.steps.length;
  // The new look (Decision 453): a white card with a light header, each step a
  // row with a ✓ or an empty circle; steps still to do link to where they're done.
  return (
    <section aria-label={t('dashboard.setup.title')} className="u8n-dash__card u8n-dash-setup">
      <header className="u8n-dash__card-head">
        <h2 className="u8n-dash__card-title">{allDone ? t('dashboard.setup.doneTitle') : t('dashboard.setup.title')}</h2>
        <div className="u8n-dash-setup__tools">
          <span className="u8n-dash-setup__progress">{t('dashboard.setup.progress', { done, total: checklist.steps.length })}</span>
          <Button variant="secondary" onClick={() => setHidden.mutate(true)} disabled={setHidden.isPending}>
            {t('dashboard.setup.hide')}
          </Button>
        </div>
      </header>
      <ul className="u8n-dash-setup__steps">
        {checklist.steps.map((step) => {
          const meta = STEPS[step.key];
          return (
            <li key={step.key} data-step={step.key} data-done={step.done} className="u8n-dash-setup__step">
              <span
                role="img"
                aria-label={step.done ? t('dashboard.setup.doneLabel') : t('dashboard.setup.todoLabel')}
                className={'u8n-dash-setup__mark' + (step.done ? ' u8n-dash-setup__mark--done' : '')}
              >
                {step.done ? '✓' : ''}
              </span>
              <div className="u8n-dash-setup__text">
                {meta.to && !step.done ? <Link to={meta.to}>{t(meta.label)}</Link> : <span className={step.done ? 'u8n-dash-setup__done' : undefined}>{t(meta.label)}</span>}
                {step.key === 'STRIPE' && !step.done ? <span className="u8n-dash-setup__hint">{t('dashboard.setup.stripeHint')}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {/* Decision 437 — where Stripe can't onboard the School, the API leaves
          the Stripe step out; say how members pay instead. */}
      {checklist.stripeConnectAvailable === false ? (
        <p data-testid="stripe-unavailable" className="u8n-dash-setup__note">
          {t(pix ? 'dashboard.setup.stripeUnavailablePix' : 'dashboard.setup.stripeUnavailable')}
        </p>
      ) : null}
    </section>
  );
}
