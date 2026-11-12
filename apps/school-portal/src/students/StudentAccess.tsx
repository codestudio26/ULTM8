import React, { useState } from 'react';
import { Button, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { BillingCard } from '../billing/BillingLook';
import './studentNotices.css';
import { useChildInvites, useNewTemporaryPasscode, useTemporaryPasscodeStatus, useWithdrawChildInvite } from './studentAccessQueries';

/**
 * Children added for a Guardian who already has an account, waiting for the
 * Guardian to accept in the app (Decision 403). The owner can withdraw one.
 * Hidden when there are none. In the new look (Decision 453): a white card
 * above the Students list, like the freeze requests.
 */
export function ChildInvitesCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const invites = useChildInvites(schoolId);
  const withdraw = useWithdrawChildInvite(schoolId);
  const items = invites.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="u8n-notice">
      <BillingCard>
        <section aria-label={t('students.childInvites.title')}>
          <h2 className="u8b-card__title">{t('students.childInvites.title')}</h2>
          <p className="u8b-note u8n-notice__hint">{t('students.childInvites.hint')}</p>
          {withdraw.error ? <ErrorBanner message={withdraw.error instanceof ApiError ? withdraw.error.message : t('common.tryAgain')} /> : null}
          <ul className="u8n-notice__rows">
            {items.map((i) => {
              const child = `${i.childFirstName} ${i.childSurname}`.trim();
              return (
                <li key={i.id} className="u8n-notice__row">
                  <span className="u8n-notice__text">{t('students.childInvites.row', { child, guardian: i.guardianName ?? i.guardianEmail ?? '' })}</span>
                  <span className="u8n-notice__actions">
                    <Button
                      variant="secondary"
                      className="u8b-pill u8b-pill--row"
                      disabled={withdraw.isPending}
                      onClick={() => withdraw.mutate(i.id)}
                      aria-label={t('students.childInvites.withdrawAria', { child })}
                    >
                      {t('students.childInvites.withdraw')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </BillingCard>
    </div>
  );
}

/**
 * App access on a student's page (Decision 403): while the account the
 * School made (the student's, or a child's Guardian's) hasn't been signed in
 * to, the owner can make a new temporary passcode, shown once. Hidden
 * otherwise. It sits in the student page's summary panel (the design's
 * "Send access").
 */
export function TemporaryPasscodeCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const status = useTemporaryPasscodeStatus(schoolId, studentId, true);
  const renew = useNewTemporaryPasscode(schoolId, studentId);
  const [shown, setShown] = useState<{ passcode: string; name: string } | null>(null);
  const s = status.data;
  if (!shown && (!s || !s.available)) return null;
  const name = s?.accountName ?? '';
  return (
    <section aria-label={t('students.passcode.title')}>
      <h3 className="u8n-student-panel__heading">{t('students.passcode.title')}</h3>
      {shown ? (
        <>
          <p className="u8sp-panel__text">{t('students.passcode.shown', { name: shown.name })}</p>
          {/* Shown once, in the same dashed ticket as the check-in code above it. */}
          <div className="u8sp-ticket">
            <p className="u8sp-ticket__code" data-testid="temporary-passcode">
              {shown.passcode}
            </p>
          </div>
          <p className="u8sp-panel__note">{t('students.addManually.passcodeOnceDays')}</p>
        </>
      ) : (
        <>
          <p className="u8sp-panel__text">
            {s?.expired
              ? t('students.passcode.expired', { name })
              : s?.forGuardian
                ? t('students.passcode.waitingGuardian', { name })
                : t('students.passcode.waiting', { name })}
          </p>
          {renew.error ? <ErrorBanner message={renew.error instanceof ApiError ? renew.error.message : t('common.tryAgain')} /> : null}
          <div className="u8sp-panel__buttons">
            <Button
              variant="secondary"
              loading={renew.isPending}
              onClick={() => renew.mutate(undefined, { onSuccess: (res) => setShown({ passcode: res.temporaryPasscode, name: res.accountName }) })}
            >
              {t('students.passcode.button')}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
