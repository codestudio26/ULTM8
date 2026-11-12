import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AddressFields, Button, CurrencyField, ErrorBanner, Field, NewLookSelect, PasscodeField, PhoneField, TextField, postalAddressFromRecord, preparePostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { languageName } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { LegalAgreeCheckbox } from '../legal/LegalAgreeCheckbox';
import { SignInCard, SignInSuccessCard } from './SignInCard';

/** Fields match RegisterDto exactly (apps/api/src/auth/dto/register.dto.ts) — nothing
 * added or removed. Required fields first; the rest of the confirmed base User fields
 * (ultm8-domain-rules §3) are optional here exactly as they're optional on the DTO. */
export function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  // A coach invite link passes the invited email along (Decision 183).
  const invitedEmail = (useLocation() as { state?: { email?: string } }).state?.email ?? '';

  const [form, setForm] = useState({
    email: invitedEmail,
    phone: '',
    firstName: '',
    surname: '',
    username: '',
    passcode: '',
    passcodeConfirm: '',
    dateOfBirth: '',
    gender: '',
    nationality: '',
    language: '',
    currency: '',
  });
  const [address, setAddress] = useState(() => postalAddressFromRecord(null, guessDefaultCountry()));
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  // Decision 444 (C1): the Terms and Privacy tick, sent as acceptTerms.
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (form.passcode !== form.passcodeConfirm) {
      setError(t('auth.register.passcodeMismatch'));
      return;
    }
    const prepared = preparePostalAddress(address);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});

    setSubmitting(true);
    try {
      await unwrap(
        apiClient.POST('/v1/auth/register', {
          body: {
            email: form.email,
            phone: form.phone,
            firstName: form.firstName,
            surname: form.surname,
            username: form.username || undefined,
            passcode: form.passcode,
            passcodeConfirm: form.passcodeConfirm,
            dateOfBirth: form.dateOfBirth,
            gender: form.gender === 'FEMALE' || form.gender === 'MALE' ? form.gender : undefined,
            nationality: form.nationality || undefined,
            language: form.language || undefined,
            currency: form.currency || undefined,
            postalAddress: prepared.postalAddress ?? undefined,
            acceptTerms,
          },
        }),
      );
      // Registration sends the OTP itself (AuthService.register()) — no separate send call needed.
      setCreated(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <SignInSuccessCard
        title={t('auth.register.successTitle')}
        subtitle={t('auth.register.successSubtitle')}
        onContinue={() => navigate('/verify-otp', { state: { phone: form.phone } })}
      />
    );
  }

  return (
    <SignInCard
      wide
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      footer={
        <Trans k="auth.register.alreadyHaveAccount" nodes={{ link: <Link to="/login">{t('auth.logIn')}</Link> }} />
      }
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('auth.emailLabel')} htmlFor="reg-email">
          <TextField type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label={t('auth.phoneLabel')} htmlFor="reg-phone">
          <PhoneField required value={form.phone} onChange={(v) => set('phone', v)} defaultCountry={guessDefaultCountry()} />
        </Field>
        <div className="ultm8-field-row">
          <Field label={t('auth.register.firstName')} htmlFor="reg-firstName">
            <TextField required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label={t('auth.register.surname')} htmlFor="reg-surname">
            <TextField required value={form.surname} onChange={(e) => set('surname', e.target.value)} />
          </Field>
        </div>
        <div className="ultm8-field-row">
          <Field label={t('auth.passcodeLabel')} htmlFor="reg-passcode" hint={t('auth.register.passcodeHint')}>
            <PasscodeField
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={form.passcode}
              onChange={(e) => set('passcode', e.target.value)}
            />
          </Field>
          <Field label={t('auth.register.confirmPasscode')} htmlFor="reg-passcodeConfirm">
            <PasscodeField
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={form.passcodeConfirm}
              onChange={(e) => set('passcodeConfirm', e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('auth.register.dateOfBirth')} htmlFor="reg-dob">
          <TextField type="date" required value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
        </Field>

        <details className="ultm8-details">
          <summary>{t('auth.register.optionalDetails')}</summary>
          <Field label={t('auth.register.username')} htmlFor="reg-username" hint={t('auth.register.usernameHint')}>
            <TextField value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          {/* Decision 315 item 15: Female, Male or not given. Three short
              choices, so pills (DESIGN.md → form pattern "F"). */}
          <div className="ultm8-field">
            <span className="ultm8-field__label" id="reg-gender-label">
              {t('auth.register.gender')}
            </span>
            <div className="ultm8-pills" role="group" aria-labelledby="reg-gender-label">
              {[
                { value: '', label: t('schools.form.notSet') },
                { value: 'FEMALE', label: t('frontDesk.signUp.female') },
                { value: 'MALE', label: t('frontDesk.signUp.male') },
              ].map((g) => (
                <button key={g.value || 'none'} type="button" className="ultm8-pills__option" aria-pressed={form.gender === g.value} onClick={() => set('gender', g.value)}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <Field label={t('auth.register.nationality')} htmlFor="reg-nationality">
            <TextField value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </Field>
          <div className="u8n-dd-field">
            <NewLookSelect
              id="reg-language"
              label={t('auth.register.language')}
              value={form.language}
              onChange={(v) => set('language', v)}
              options={[{ value: '', label: t('schools.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
            />
          </div>
          <Field label={t('auth.register.currency')} htmlFor="reg-currency">
            <CurrencyField
              id="reg-currency"
              value={form.currency}
              onChange={(code) => set('currency', code)}
              options={[{ code: '', name: t('schools.form.notSet') }, ...(currencies ?? [])]}
              placeholder={t('schools.form.notSet')}
            />
          </Field>
          <AddressFields idPrefix="reg-address" value={address} onChange={setAddress} errors={addressErrors} />
        </details>

        <LegalAgreeCheckbox kind="account" checked={acceptTerms} onChange={setAcceptTerms} />

        <div className="u8si-actions">
          <Button type="submit" fullWidth loading={submitting}>
            {t('auth.register.submit')}
          </Button>
        </div>
      </form>
    </SignInCard>
  );
}
