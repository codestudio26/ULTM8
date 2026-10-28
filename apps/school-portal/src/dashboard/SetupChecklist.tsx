import React from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '@ultm8/ui';
import { useSetSetupChecklistHidden, type DashboardOverview, type SetupStepKey } from './dashboardQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Where each step is done. Stripe has no portal screen yet: ULTM8 support
 * connects it, so it has no link. */
const STEPS: Record<SetupStepKey, { label: TranslationKey; to: string | null }> = {
  BRANCH: { label: 'dashboard.setup.steps.BRANCH', to: '/branches' },
  STYLE_AND_BELTS: { label: 'dashboard.setup.steps.STYLE_AND_BELTS', to: '/disciplines' },
  CLASS: { label: 'dashboard.setup.steps.CLASS', to: '/timetable' },
  MEMBERSHIP_PLAN: { label: 'dashboard.setup.steps.MEMBERSHIP_PLAN', to: '/membership-plans' },
  WAIVER: { label: 'dashboard.setup.steps.WAIVER', to: '/waivers' },
  STRIPE: { label: 'dashboard.setup.steps.STRIPE', to: null },
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
  if (checklist.hidden) {
    return (
      <p style={{ margin: '0 0 16px', fontSize: 13 }}>
        <Button variant="secondary" onClick={() => setHidden.mutate(false)} disabled={setHidden.isPending}>
          {t('dashboard.setup.show')}
        </Button>
      </p>
    );
  }
  const done = checklist.steps.filter((s) => s.done).length;
  const allDone = done === checklist.steps.length;
  return (
    <section aria-label={t('dashboard.setup.title')} style={{ marginBottom: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
            {allDone ? t('dashboard.setup.doneTitle') : t('dashboard.setup.title')}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)' }}>
              {t('dashboard.setup.progress', { done, total: checklist.steps.length })}
            </span>
            <Button variant="secondary" onClick={() => setHidden.mutate(true)} disabled={setHidden.isPending}>
              {t('dashboard.setup.hide')}
            </Button>
          </div>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {checklist.steps.map((step) => {
            const meta = STEPS[step.key];
            return (
              <li key={step.key} data-step={step.key} data-done={step.done} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 14 }}>
                <span role="img" aria-label={step.done ? t('dashboard.setup.doneLabel') : t('dashboard.setup.todoLabel')} style={{ width: 18, color: step.done ? 'var(--ultm8-color-success, #2e7d4f)' : 'var(--ultm8-color-text-muted, #666)' }}>
                  {step.done ? '✓' : '○'}
                </span>
                {meta.to && !step.done ? <Link to={meta.to}>{t(meta.label)}</Link> : <span style={step.done ? { textDecoration: 'line-through' } : undefined}>{t(meta.label)}</span>}
                {step.key === 'STRIPE' && !step.done ? (
                  <span style={{ fontSize: 13, color: 'var(--ultm8-color-text-muted, #666)' }}>{t('dashboard.setup.stripeHint')}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
