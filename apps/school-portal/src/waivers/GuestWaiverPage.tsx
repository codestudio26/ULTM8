import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AuthCard, Button, Checkbox, ErrorBanner, Field, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGuestWaiverLink, useSignGuestWaivers } from './guestWaiverQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Whole years on today's date for a YYYY-MM-DD date of birth, or null. */
function ageFrom(dob: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

/**
 * The guest waiver link (Waivers Q9). A guest on someone's booking opens it
 * with no account, reads the School's current waivers and signs them all at
 * once: their name, date of birth and a typed signature. For a guest under 18
 * a parent or guardian signs. The API checks everything again.
 */
export function GuestWaiverPage() {
  const t = useT();
  const { token = '' } = useParams<{ token: string }>();
  const link = useGuestWaiverLink(token);
  const sign = useSignGuestWaivers(token);
  const [guestName, setGuestName] = useState('');
  const [dob, setDob] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [signature, setSignature] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedName, setSignedName] = useState<string | null>(null);

  if (link.isLoading) return <Spinner />;
  if (link.error || !link.data) {
    return (
      <AuthCard title={t('waivers.guestPage.title')}>
        <ErrorBanner message={link.error instanceof ApiError && link.error.status !== 404 ? link.error.message : t('waivers.guestPage.invalid')} />
      </AuthCard>
    );
  }

  const data = link.data;
  const when = new Date(data.classStartsAt).toLocaleString(formatLocale(), { dateStyle: 'full', timeStyle: 'short' });
  const subtitle = `${data.schoolName} · ${data.classTitle}`;
  const unsigned = data.waivers.filter((w) => !w.signed);

  if (data.status === 'CLOSED') {
    return (
      <AuthCard title={t('waivers.guestPage.title')} subtitle={subtitle}>
        <ErrorBanner message={t('waivers.guestPage.closed')} />
      </AuthCard>
    );
  }
  if (signedName || (data.waivers.length > 0 && unsigned.length === 0)) {
    return (
      <AuthCard title={t('waivers.guestPage.title')} subtitle={subtitle}>
        <SuccessBanner message={t('waivers.guestPage.done', { name: signedName ?? data.guestFullName ?? '', school: data.schoolName })} />
      </AuthCard>
    );
  }
  if (data.waivers.length === 0) {
    return (
      <AuthCard title={t('waivers.guestPage.title')} subtitle={subtitle}>
        <p>{t('waivers.guestPage.nothing', { school: data.schoolName })}</p>
      </AuthCard>
    );
  }

  const age = ageFrom(dob);
  const minor = age !== null && age < 18;
  const signer = minor ? guardianName.trim() : guestName.trim();
  const ready = guestName.trim() !== '' && age !== null && signer !== '' && signature.trim() !== '' && agreed;

  async function submit() {
    setError(null);
    try {
      await sign.mutateAsync({
        guestFullName: guestName.trim(),
        guestDateOfBirth: dob,
        signerFullName: signer,
        signatureText: signature.trim(),
        waivers: unsigned.map((w) => ({ waiverId: w.id, version: w.version })),
      });
      setSignedName(guestName.trim());
    } catch (err) {
      setError(errorText(err, t('waivers.guestPage.failed')));
      // A waiver changed while being read: show the new wording.
      if (err instanceof ApiError && err.status === 409) void link.refetch();
    }
  }

  return (
    <AuthCard title={t('waivers.guestPage.title')} subtitle={subtitle}>
      <p>{t('waivers.guestPage.intro', { school: data.schoolName, class: data.classTitle, when })}</p>
      {unsigned.map((w) => (
        <section key={w.id} aria-label={w.title} style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: '12px 0 6px' }}>{w.title}</h2>
          <div style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflowY: 'auto', border: '1px solid var(--ultm8-border, #ddd)', borderRadius: 8, padding: 12 }}>{w.body}</div>
        </section>
      ))}
      {error ? <ErrorBanner message={error} /> : null}
      <Field label={t('waivers.guestPage.guestName')} htmlFor="guest-name">
        <TextField id="guest-name" autoComplete="name" value={guestName} maxLength={200} onChange={(e) => setGuestName(e.target.value)} />
      </Field>
      <Field label={t('waivers.guestPage.dob')} htmlFor="guest-dob">
        <TextField id="guest-dob" type="date" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDob(e.target.value)} />
      </Field>
      {minor ? (
        <Field label={t('waivers.guestPage.guardianName')} htmlFor="guest-guardian" hint={t('waivers.guestPage.minorNote')}>
          <TextField id="guest-guardian" autoComplete="name" value={guardianName} maxLength={200} onChange={(e) => setGuardianName(e.target.value)} />
        </Field>
      ) : null}
      <Field label={t('waivers.guestPage.signature')} htmlFor="guest-signature">
        <TextField id="guest-signature" value={signature} maxLength={200} onChange={(e) => setSignature(e.target.value)} />
      </Field>
      <Checkbox label={t('waivers.guestPage.agree')} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
      <div style={{ marginTop: 12 }}>
        <Button onClick={submit} loading={sign.isPending} disabled={!ready}>
          {t('waivers.guestPage.sign')}
        </Button>
      </div>
    </AuthCard>
  );
}
