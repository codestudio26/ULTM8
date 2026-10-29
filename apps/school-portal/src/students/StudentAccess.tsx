import React, { useState } from 'react';
import { Button, Card, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useChildInvites, useNewTemporaryPasscode, useTemporaryPasscodeStatus, useWithdrawChildInvite } from './studentAccessQueries';

/**
 * Children added for a Guardian who already has an account, waiting for the
 * Guardian to accept in the app (Decision 403). The owner can withdraw one.
 * Hidden when there are none.
 */
export function ChildInvitesCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const invites = useChildInvites(schoolId);
  const withdraw = useWithdrawChildInvite(schoolId);
  const items = invites.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <Card>
        <section aria-label={t('students.childInvites.title')}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 4 }}>
            {t('students.childInvites.title')}
          </h2>
          <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
            {t('students.childInvites.hint')}
          </p>
          {withdraw.error ? <ErrorBanner message={withdraw.error instanceof ApiError ? withdraw.error.message : t('common.tryAgain')} /> : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {items.map((i) => {
              const child = `${i.childFirstName} ${i.childSurname}`.trim();
              return (
                <li key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{t('students.childInvites.row', { child, guardian: i.guardianName ?? i.guardianEmail ?? '' })}</span>
                  <Button variant="secondary" disabled={withdraw.isPending} onClick={() => withdraw.mutate(i.id)} aria-label={t('students.childInvites.withdrawAria', { child })}>
                    {t('students.childInvites.withdraw')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </Card>
    </div>
  );
}

/**
 * App access on a student's page (Decision 403): while the account the
 * School made (the student's, or a child's Guardian's) hasn't been signed in
 * to, the owner can make a new temporary passcode, shown once. Hidden
 * otherwise.
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
    <div style={{ marginBottom: 24 }}>
      <Card>
        <section aria-label={t('students.passcode.title')}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
            {t('students.passcode.title')}
          </h2>
          {shown ? (
            <>
              <p>{t('students.passcode.shown', { name: shown.name })}</p>
              <p data-testid="temporary-passcode" style={{ fontSize: 24, fontWeight: 600, letterSpacing: 4 }}>
                {shown.passcode}
              </p>
              <p className="ultm8-field__hint">{t('students.addManually.passcodeOnceDays')}</p>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                {s?.expired
                  ? t('students.passcode.expired', { name })
                  : s?.forGuardian
                    ? t('students.passcode.waitingGuardian', { name })
                    : t('students.passcode.waiting', { name })}
              </p>
              {renew.error ? <ErrorBanner message={renew.error instanceof ApiError ? renew.error.message : t('common.tryAgain')} /> : null}
              <Button
                variant="secondary"
                loading={renew.isPending}
                onClick={() => renew.mutate(undefined, { onSuccess: (res) => setShown({ passcode: res.temporaryPasscode, name: res.accountName }) })}
              >
                {t('students.passcode.button')}
              </Button>
            </>
          )}
        </section>
      </Card>
    </div>
  );
}
