import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCard, AuthSuccessCard, Button, ErrorBanner, Field, PasscodeField, TextField } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Fields match RegisterDto exactly (apps/api/src/auth/dto/register.dto.ts) — nothing
 * added or removed. Required fields first; the rest of the confirmed base User fields
 * (ultm8-domain-rules §3) are optional here exactly as they're optional on the DTO. */
export function RegisterPage() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
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
    address: '',
  });
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
      setError('Passcode and confirmation must match.');
      return;
    }

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
            gender: form.gender || undefined,
            nationality: form.nationality || undefined,
            language: form.language || undefined,
            currency: form.currency || undefined,
            address: form.address || undefined,
          },
        }),
      );
      // Registration sends the OTP itself (AuthService.register()) — no separate send call needed.
      setCreated(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <AuthSuccessCard
        title="Account created"
        subtitle="Thanks for joining — next, verify your phone number."
        onContinue={() => navigate('/verify-otp', { state: { phone: form.phone } })}
      />
    );
  }

  return (
    <AuthCard
      title="Create your School account"
      subtitle="Register, then verify your phone — you'll create your School next."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Email" htmlFor="reg-email">
          <TextField type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="reg-phone" hint="E.164 format, e.g. +15551234567">
          <TextField type="tel" required value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <div className="ultm8-field-row">
          <Field label="First name" htmlFor="reg-firstName">
            <TextField required value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
          </Field>
          <Field label="Surname" htmlFor="reg-surname">
            <TextField required value={form.surname} onChange={(e) => set('surname', e.target.value)} />
          </Field>
        </div>
        <div className="ultm8-field-row">
          <Field label="Passcode" htmlFor="reg-passcode" hint="6 digits — this is your entire login credential">
            <PasscodeField
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={form.passcode}
              onChange={(e) => set('passcode', e.target.value)}
            />
          </Field>
          <Field label="Confirm passcode" htmlFor="reg-passcodeConfirm">
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
        <Field label="Date of birth" htmlFor="reg-dob">
          <TextField type="date" required value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
        </Field>

        <details className="ultm8-details">
          <summary>Optional details</summary>
          <Field label="Username" htmlFor="reg-username" hint="Mobile app only">
            <TextField value={form.username} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Gender" htmlFor="reg-gender">
            <TextField value={form.gender} onChange={(e) => set('gender', e.target.value)} />
          </Field>
          <Field label="Nationality" htmlFor="reg-nationality">
            <TextField value={form.nationality} onChange={(e) => set('nationality', e.target.value)} />
          </Field>
          <Field label="Language" htmlFor="reg-language">
            <TextField value={form.language} onChange={(e) => set('language', e.target.value)} />
          </Field>
          <Field label="Currency" htmlFor="reg-currency">
            <TextField value={form.currency} onChange={(e) => set('currency', e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="reg-address">
            <TextField value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </details>

        <div style={{ marginTop: 16 }}>
          <Button type="submit" fullWidth loading={submitting}>
            Create account
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
