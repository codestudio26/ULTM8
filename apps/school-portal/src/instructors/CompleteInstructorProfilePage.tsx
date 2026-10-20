import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, PageHeader, SuccessBanner, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCompleteMyInstructorProfile, useRequestCertificationUploadUrl } from './instructorQueries';
import { useT } from '../i18n/I18nProvider';

const ALLOWED_CERTIFICATION_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/**
 * Decision 1/217/237 — self-service completion of the four fields "Add
 * Manually" leaves blank at creation (Address, Activities, Certification,
 * consent). Reachable from a banner elsewhere — not a blocking gate; an
 * Instructor can use the rest of the app without ever visiting this page.
 * Applies to every Instructor row the caller holds (flagged limitation,
 * same as the backend: can't set different values per School here).
 */
export function CompleteInstructorProfilePage() {
  const t = useT();
  const complete = useCompleteMyInstructorProfile();
  const requestUploadUrl = useRequestCertificationUploadUrl();

  const [address, setAddress] = useState('');
  const [activities, setActivities] = useState('');
  const [certificationFile, setCertificationFile] = useState<File | null>(null);
  const [certificationConsent, setCertificationConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function uploadCertificationIfAny(): Promise<string | undefined> {
    if (!certificationFile) return undefined;
    if (!ALLOWED_CERTIFICATION_TYPES.includes(certificationFile.type as (typeof ALLOWED_CERTIFICATION_TYPES)[number])) {
      throw new Error(t('instructors.completeProfile.invalidFileType'));
    }
    setUploading(true);
    try {
      const { uploadUrl, objectKey } = await requestUploadUrl.mutateAsync(certificationFile.type as (typeof ALLOWED_CERTIFICATION_TYPES)[number]);
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': certificationFile.type }, body: certificationFile });
      if (!putRes.ok) throw new Error(t('instructors.completeProfile.uploadFailed'));
      return objectKey;
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const certificationKey = await uploadCertificationIfAny();
      await complete.mutateAsync({
        ...(address ? { address } : {}),
        ...(activities.trim() ? { activities: activities.split(',').map((a) => a.trim()).filter(Boolean) } : {}),
        ...(certificationKey ? { certificationKey } : {}),
        ...(certificationConsent ? { certificationConsent: true } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('common.tryAgain'));
    }
  }

  const submitting = complete.isPending || uploading;

  return (
    <>
      <PageHeader title={t('instructors.completeProfile.title')} subtitle={t('instructors.completeProfile.subtitle')} />
      {saved ? <SuccessBanner message={t('instructors.completeProfile.saved')} /> : null}
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={handleSubmit}>
        <Field label={t('instructors.completeProfile.address')} htmlFor="complete-profile-address">
          <TextField value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label={t('instructors.completeProfile.activities')} htmlFor="complete-profile-activities" hint={t('instructors.completeProfile.activitiesHint')}>
          <TextArea value={activities} onChange={(e) => setActivities(e.target.value)} />
        </Field>
        <Field label={t('instructors.completeProfile.certification')} htmlFor="complete-profile-certification" hint={t('instructors.completeProfile.certificationHint')}>
          <input
            id="complete-profile-certification"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => setCertificationFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        {certificationFile ? (
          <Checkbox
            label={t('instructors.completeProfile.consent')}
            checked={certificationConsent}
            onChange={(e) => setCertificationConsent(e.target.checked)}
          />
        ) : null}
        <Button type="submit" loading={submitting}>
          {t('common.save')}
        </Button>
      </form>
    </>
  );
}
