import React, { useState } from 'react';
import { Button, Card, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useMembershipCard, useNewStudentCheckInCode, useStudentCheckInCode } from './frontDeskQueries';
import { membershipCardHtml } from './membershipCardHtml';

/**
 * A student's personal check-in code on their page (Decision 384, handover
 * F3): typed at the front desk when the app QR can't be shown. Staff who
 * cover the student see it and can give a new one (the old one stops
 * working); the student can't change it. Hidden when the caller can't see it.
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
    <div style={{ marginBottom: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
          {t('frontDesk.studentCode.title')}
        </h2>
        <p style={{ margin: '0 0 8px', fontSize: 28, letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums' }} data-testid="student-check-in-code">
          {code.data.code}
        </p>
        <p style={{ margin: '0 0 12px', color: 'var(--color-neutral-600)' }}>{t('frontDesk.studentCode.hint')}</p>
        {renew.error ? <ErrorBanner message={renew.error instanceof ApiError ? renew.error.message : t('frontDesk.studentCode.failed')} /> : null}
        {confirming ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{t('frontDesk.studentCode.confirm')}</span>
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
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              {t('frontDesk.studentCode.renew')}
            </Button>
            <Button variant="secondary" onClick={printCard} disabled={!card.data}>
              {t('frontDesk.card.print')}
            </Button>
          </div>
        )}
        {card.isError ? <p className="ultm8-field__hint">{t('frontDesk.card.failed')}</p> : null}
      </Card>
    </div>
  );
}
