import React, { useState } from 'react';
import { Button, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useMembershipCard, useNewStudentCheckInCode, useStudentCheckInCode } from './frontDeskQueries';
import { membershipCardHtml } from './membershipCardHtml';

/**
 * A student's personal check-in code on their page (Decision 384, handover
 * F3): typed at the front desk when the app QR can't be shown. Staff who
 * cover the student see it and can give a new one (the old one stops
 * working); the student can't change it. Hidden when the caller can't see it.
 * In the new look it sits in the student page's summary panel as a dashed
 * ticket (DESIGN-BRIEF §8, design A), with its two buttons under it.
 */
export function StudentCheckInCodeCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const code = useStudentCheckInCode(schoolId, studentId);
  const renew = useNewStudentCheckInCode(schoolId, studentId);
  const card = useMembershipCard(schoolId, studentId, !!code.data);
  const [confirming, setConfirming] = useState(false);
  if (!code.data) return null;

  // Backlog 3.11: a bank-card-sized page to print, with no QR code.
  function printCard() {
    if (!card.data) return;
    const url = URL.createObjectURL(new Blob([membershipCardHtml(t, card.data)], { type: 'text/html' }));
    window.open(url, '_blank');
  }
  return (
    <section aria-label={t('frontDesk.studentCode.title')}>
      <div className="u8sp-ticket">
        <div>
          <p className="u8sp-ticket__label">{t('frontDesk.studentCode.title')}</p>
          <p className="u8sp-ticket__code" data-testid="student-check-in-code">
            {code.data.code}
          </p>
        </div>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
        </svg>
      </div>
      <p className="u8sp-panel__note">{t('frontDesk.studentCode.hint')}</p>
      {renew.error ? <ErrorBanner message={renew.error instanceof ApiError ? renew.error.message : t('frontDesk.studentCode.failed')} /> : null}
      {confirming ? (
        <>
          <p className="u8sp-panel__text">{t('frontDesk.studentCode.confirm')}</p>
          <div className="u8sp-panel__buttons u8sp-panel__buttons--pair">
            <Button
              variant="secondary"
              disabled={renew.isPending}
              onClick={() => renew.mutate(undefined, { onSuccess: () => setConfirming(false) })}
            >
              {t('frontDesk.studentCode.confirmYes')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <div className="u8sp-panel__buttons u8sp-panel__buttons--pair">
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            {t('frontDesk.studentCode.renew')}
          </Button>
          <Button variant="secondary" onClick={printCard} disabled={!card.data}>
            {t('frontDesk.card.print')}
          </Button>
        </div>
      )}
      {card.isError ? <p className="u8sp-panel__note">{t('frontDesk.card.failed')}</p> : null}
    </section>
  );
}
