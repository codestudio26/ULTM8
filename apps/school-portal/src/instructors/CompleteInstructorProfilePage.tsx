import React, { useState } from 'react';
import { AddressFields, Button, Checkbox, ErrorBanner, Field, PageHeader, PhoneField, PhotoUploadField, Spinner, SuccessBanner, TextArea, postalAddressFromRecord, preparePostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import { useCompleteMyInstructorProfile, useMyInstructorProfiles, useRequestCertificationUploadUrl, type InstructorResponse } from './instructorQueries';
import { useT } from '../i18n/I18nProvider';

const ALLOWED_CERTIFICATION_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/**
 * Decision 1/217/237 — self-service completion of the four fields "Add
 * Manually" leaves blank at creation (Address, Activities, Certification,
 * consent). Reachable from a banner elsewhere — not a blocking gate; an
 * Instructor can use the rest of the app without ever visiting this page.
 * Applies to every Instructor row the caller holds (flagged limitation,
 * same as the backend: can't set different values per School here).
 * Starts from what's already saved (Decision 312), read from the first profile.
 * Decision 331 adds their photo, bio and the phone number the School sees
 * (not their sign-in number). Only fields that changed are sent.
 */
export function CompleteInstructorProfilePage() {
  const t = useT();
  const mine = useMyInstructorProfiles();
  if (mine.isLoading) return <Spinner />;
  if (mine.error) return <ErrorBanner message={mine.error instanceof ApiError ? mine.error.message : t('common.tryAgain')} />;
  return <CompleteInstructorProfileForm saved={mine.data?.items[0] ?? null} />;
}

function CompleteInstructorProfileForm({ saved: current }: { saved: InstructorResponse | null }) {
  const t = useT();
  const complete = useCompleteMyInstructorProfile();
  const requestUploadUrl = useRequestCertificationUploadUrl();
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  const [photoUrl, setPhotoUrl] = useState(current?.photoUrl ?? '');
  const [bio, setBio] = useState(current?.bio ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');

  const [initialAddress] = useState(() => postalAddressFromRecord(current, guessDefaultCountry()));
  const [address, setAddress] = useState(initialAddress);
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [activities, setActivities] = useState(() => (current?.activities ?? []).join(', '));
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
    const prepared = preparePostalAddress(address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      const certificationKey = await uploadCertificationIfAny();
      await complete.mutateAsync({
        ...(photoUrl !== (current?.photoUrl ?? '') ? { photoUrl: photoUrl || null } : {}),
        ...(bio.trim() !== (current?.bio ?? '') ? { bio: bio.trim() || null } : {}),
        ...(phone !== (current?.phone ?? '') ? { phone: phone || null } : {}),
        ...(prepared.postalAddress ? { postalAddress: prepared.postalAddress } : {}),
        // Emptying a saved list clears it; an untouched empty box sends nothing.
        ...(activities.trim() || (current?.activities.length ?? 0) > 0 ? { activities: activities.split(',').map((a) => a.trim()).filter(Boolean) } : {}),
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
        {current ? (
          <Field label={t('instructors.form.photo')} htmlFor="complete-profile-photo">
            <PhotoUploadField
              value={photoUrl}
              onChange={setPhotoUrl}
              requestUpload={(file) =>
                requestPhotoUpload.mutateAsync({
                  entityType: 'INSTRUCTOR',
                  schoolId: current.schoolId,
                  entityId: current.id,
                  contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
                })
              }
            />
          </Field>
        ) : null}
        <Field label={t('instructors.form.bio')} htmlFor="complete-profile-bio">
          <TextArea id="complete-profile-bio" value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Field label={t('instructors.form.phone')} htmlFor="complete-profile-phone" hint={t('instructors.completeProfile.phoneHint')}>
          <PhoneField id="complete-profile-phone" value={phone} onChange={setPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <AddressFields idPrefix="complete-profile-address" value={address} onChange={setAddress} errors={addressErrors} />
        <Field label={t('instructors.completeProfile.activities')} htmlFor="complete-profile-activities" hint={t('instructors.completeProfile.activitiesHint')}>
          <TextArea value={activities} onChange={(e) => setActivities(e.target.value)} />
        </Field>
        {current?.certificationKey ? (
          <p style={{ margin: '0 0 8px' }}>{t('instructors.completeProfile.certificationOnFile')}</p>
        ) : null}
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
