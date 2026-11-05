import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

type Switches = Pick<
  SchoolResponse,
  'memberAppEditProfile' | 'memberAppCancelMembership' | 'memberAppAddFamily' | 'memberAppPaymentHistory' | 'memberAppGradingCountdown'
>;

function switchesOf(school: SchoolResponse): Switches {
  return {
    memberAppEditProfile: school.memberAppEditProfile,
    memberAppCancelMembership: school.memberAppCancelMembership,
    memberAppAddFamily: school.memberAppAddFamily,
    memberAppPaymentHistory: school.memberAppPaymentHistory,
    memberAppGradingCountdown: school.memberAppGradingCountdown,
  };
}

const dateOnly = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

/**
 * Decision 318 item 7: what members may do in the ULTM8 app at this School.
 * Four switches gate what the app already does (on by default); the grading
 * countdown is new (off by default) and shows the next grading day the
 * School sets here. The app hides what is off and the API refuses it.
 * Owner only, like the rest of this page.
 */
export function MemberAppSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [form, setForm] = useState<Switches>(switchesOf(school));
  const [nextGradingDate, setNextGradingDate] = useState(dateOnly(school.nextGradingDate));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set(key: keyof Switches, value: boolean) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ ...form, nextGradingDate: nextGradingDate || null });
      setForm(switchesOf(updated));
      setNextGradingDate(dateOnly(updated.nextGradingDate));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const row = (key: keyof Switches, id: string, label: string, hint?: string) => (
    <div style={{ marginBottom: 12 }}>
      <Switch id={id} label={label} checked={form[key]} onChange={(v) => set(key, v)} />
      {hint ? <p style={{ fontSize: 13, opacity: 0.75, margin: '4px 0 0' }}>{hint}</p> : null}
    </div>
  );

  return (
    <Card>
      <form id="member-app" onSubmit={save} data-testid="member-app-settings">
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.memberApp.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.memberApp.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        {row('memberAppEditProfile', 'member-app-edit-profile', t('schools.memberApp.editProfile'), t('schools.memberApp.editProfileHint'))}
        {row('memberAppCancelMembership', 'member-app-cancel-membership', t('schools.memberApp.cancelMembership'), t('schools.memberApp.cancelMembershipHint'))}
        {row('memberAppAddFamily', 'member-app-add-family', t('schools.memberApp.addFamily'), t('schools.memberApp.addFamilyHint'))}
        {row('memberAppPaymentHistory', 'member-app-payment-history', t('schools.memberApp.paymentHistory'))}
        {row('memberAppGradingCountdown', 'member-app-grading-countdown', t('schools.memberApp.gradingCountdown'), t('schools.memberApp.gradingCountdownHint'))}
        <Field label={t('schools.memberApp.nextGradingDate')} htmlFor="member-app-next-grading-date" hint={t('schools.memberApp.nextGradingDateHint')}>
          <TextField
            id="member-app-next-grading-date"
            type="date"
            value={nextGradingDate}
            onChange={(e) => {
              setNextGradingDate(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Button type="submit" loading={update.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}
