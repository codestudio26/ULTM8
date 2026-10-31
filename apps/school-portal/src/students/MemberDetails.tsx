import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatCalendarDay } from '../membershipPlans/freezeQueries';
import { useStudentProfile } from './studentQueries';

/** Decision 315 item 5: the member's other contacts. Not logins. */
export type MemberContacts = {
  secondaryPhone: string;
  secondaryEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};
export type MemberContactKey = keyof MemberContacts;

/**
 * The secondary phone and email, and the emergency contact (someone who is
 * not a Guardian and has no account), as form fields. With `collapsed` (Add
 * student), each part starts as a "+ …" button and opens when pressed, or
 * when it already has a value.
 */
export function MemberContactFields({
  idPrefix,
  value,
  onChange,
  collapsed = false,
}: {
  idPrefix: string;
  value: MemberContacts;
  onChange: (key: MemberContactKey, value: string) => void;
  collapsed?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState({ phone: false, email: false, emergency: false });
  const show = {
    phone: !collapsed || open.phone || !!value.secondaryPhone,
    email: !collapsed || open.email || !!value.secondaryEmail,
    emergency: !collapsed || open.emergency || !!(value.emergencyContactName || value.emergencyContactPhone || value.emergencyContactRelationship),
  };
  const opener = (part: keyof typeof open, label: string) => (
    <Button type="button" variant="secondary" onClick={() => setOpen((o) => ({ ...o, [part]: true }))}>
      {label}
    </Button>
  );
  const closed = [
    show.phone ? null : opener('phone', t('students.addManually.addSecondaryPhone')),
    show.email ? null : opener('email', t('students.addManually.addSecondaryEmail')),
    show.emergency ? null : opener('emergency', t('students.addManually.addEmergencyContact')),
  ].filter(Boolean);

  return (
    <>
      {show.phone ? (
        <Field label={t('students.update.secondaryPhone')} htmlFor={`${idPrefix}-secondary-phone`} hint={t('students.update.secondaryHint')}>
          <TextField type="tel" maxLength={40} value={value.secondaryPhone} onChange={(e) => onChange('secondaryPhone', e.target.value)} />
        </Field>
      ) : null}
      {show.email ? (
        <Field label={t('students.update.secondaryEmail')} htmlFor={`${idPrefix}-secondary-email`} hint={t('students.update.secondaryHint')}>
          <TextField type="email" maxLength={254} value={value.secondaryEmail} onChange={(e) => onChange('secondaryEmail', e.target.value)} />
        </Field>
      ) : null}
      {show.emergency ? (
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
          <legend className="ultm8-field__label" style={{ fontSize: 15 }}>
            {t('students.update.emergencyHeading')}
          </legend>
          <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
            {t('students.update.emergencyHint')}
          </p>
          <Field label={t('students.update.emergencyName')} htmlFor={`${idPrefix}-emergency-name`}>
            <TextField maxLength={100} value={value.emergencyContactName} onChange={(e) => onChange('emergencyContactName', e.target.value)} />
          </Field>
          <Field label={t('students.update.emergencyPhone')} htmlFor={`${idPrefix}-emergency-phone`}>
            <TextField type="tel" maxLength={40} value={value.emergencyContactPhone} onChange={(e) => onChange('emergencyContactPhone', e.target.value)} />
          </Field>
          <Field label={t('students.update.emergencyRelationship')} htmlFor={`${idPrefix}-emergency-relationship`}>
            <TextField maxLength={60} value={value.emergencyContactRelationship} onChange={(e) => onChange('emergencyContactRelationship', e.target.value)} />
          </Field>
        </fieldset>
      ) : null}
      {closed.length > 0 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>{closed}</div> : null}
    </>
  );
}

/**
 * The student page's member details (Decision 315 items 4, 5): when they
 * joined this School, and their other contacts. Read from the same profile
 * the Edit page uses, so the same staff see it (GET …/profile).
 */
export function MemberDetailsCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const profile = useStudentProfile(schoolId, studentId);
  const row = (label: string, value: React.ReactNode, testId: string) => (
    <div style={{ display: 'flex', gap: 12, margin: '4px 0' }}>
      <span style={{ minWidth: 160, color: 'var(--text-secondary)' }}>{label}</span>
      <span data-testid={testId}>{value}</span>
    </div>
  );
  const p = profile.data;
  const notGiven = <span style={{ color: 'var(--text-secondary)' }}>{t('students.details.notGiven')}</span>;
  const emergency = p
    ? [p.emergencyContactName, p.emergencyContactRelationship ? `(${p.emergencyContactRelationship})` : null, p.emergencyContactPhone].filter(Boolean).join(' ')
    : '';
  return (
    <div style={{ marginBottom: 24 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
          {t('students.details.title')}
        </h2>
        {profile.isLoading ? (
          <Spinner />
        ) : profile.error ? (
          <ErrorBanner message={profile.error instanceof ApiError ? profile.error.message : t('students.details.loadFailed')} />
        ) : p ? (
          <>
            {row(t('students.columnJoined'), p.joinedOn ? formatCalendarDay(p.joinedOn) : notGiven, 'member-joined')}
            {row(t('students.update.secondaryPhone'), p.secondaryPhone ? <a href={`tel:${p.secondaryPhone}`}>{p.secondaryPhone}</a> : notGiven, 'member-secondary-phone')}
            {row(t('students.update.secondaryEmail'), p.secondaryEmail ? <a href={`mailto:${p.secondaryEmail}`}>{p.secondaryEmail}</a> : notGiven, 'member-secondary-email')}
            {row(t('students.update.emergencyHeading'), emergency || notGiven, 'member-emergency')}
          </>
        ) : null}
      </Card>
    </div>
  );
}
