import React, { useEffect, useState } from 'react';
import { AddressFields, Badge, Button, Card, Checkbox, CurrencyField, ErrorBanner, Field, Modal, PageHeader, PhoneField, SelectField, Spinner, SuccessBanner, Switch, TextArea, TextField, TimezoneField, hasLegacyAddressOnly, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import { useJoinFranchise, useLeaveFranchise, useSchool, useSchoolFranchiseBranding, useUpdateSchool, type SchoolResponse } from './schoolQueries';
import { useT } from '../i18n/I18nProvider';
import { languageName } from '../i18n/format';
import { Trans } from '../i18n/Trans';

/** School Owner/Manager's own School profile — view + update (Spec §8.2: "Manage
 * their own School"). Field list matches UpdateSchoolDto exactly, same as
 * CreateSchoolPage. No delete action — general tenant offboarding is [UNRESOLVED]
 * (ultm8-domain-rules §2), and apps/api has no DELETE /schools endpoint to call. */
export function SchoolPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const { data: school, isLoading, error: loadError } = useSchool(schoolId);
  const updateSchool = useUpdateSchool(schoolId ?? '');
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();

  const [form, setForm] = useState<{
    name: string;
    mobileNumber: string;
    address: PostalAddress;
    businessType: string;
    activities: string;
    facilities: string;
    ranksToggle: boolean;
    defaultLanguage: string;
    defaultCurrency: string;
    timezone: string;
    description: string;
    classCancellationPolicy: 'MANUAL' | 'AUTO_REFUND' | 'AUTO_CREDIT';
    waitlistClaimWindowMinutes: number;
    checkInOpensMinutesBeforeStart: number;
    lateCancelRefundPolicy: 'NO_REFUND_ONCE_STARTED' | 'REFUND_UNTIL_END' | 'ALWAYS_REFUND';
  } | null>(null);
  const [initialAddress, setInitialAddress] = useState<PostalAddress | undefined>(undefined);
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!school) return;
    const address = postalAddressFromRecord(school, guessDefaultCountry());
    setInitialAddress(address);
    setAddressErrors({});
    setForm({
      name: school.name,
      mobileNumber: school.mobileNumber ?? '',
      address,
      businessType: school.businessType ?? '',
      activities: school.activities.join(', '),
      facilities: school.facilities.join(', '),
      ranksToggle: school.ranksToggle,
      defaultLanguage: school.defaultLanguage ?? '',
      defaultCurrency: school.defaultCurrency ?? '',
      timezone: school.timezone ?? '',
      description: school.description ?? '',
      classCancellationPolicy: school.classCancellationPolicy,
      waitlistClaimWindowMinutes: school.waitlistClaimWindowMinutes,
      checkInOpensMinutesBeforeStart: school.checkInOpensMinutesBeforeStart,
      lateCancelRefundPolicy: school.lateCancelRefundPolicy,
    });
  }, [school]);

  function set<K extends keyof NonNullable<typeof form>>(key: K, value: NonNullable<typeof form>[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSaved(false);
    const prepared = preparePostalAddress(form.address, initialAddress);
    if (!prepared.ok) {
      setAddressErrors(prepared.errors);
      return;
    }
    setAddressErrors({});
    try {
      // `null` (not `undefined`) for a cleared field — UpdateSchoolDto accepts
      // null on these fields to mean "clear it" (FOUND ON REVIEW, Phase 18:
      // this exact "clearing a field silently no-ops" bug has been live since
      // Phase 3, see that DTO's own header comment). SchoolPage is edit-only
      // (School creation is CreateSchoolPage's own separate flow), so there's
      // no create-path mapping to undefined needed here.
      await updateSchool.mutateAsync({
        name: form.name,
        mobileNumber: form.mobileNumber || null,
        postalAddress: prepared.postalAddress,
        businessType: form.businessType || null,
        activities: form.activities.split(',').map((s) => s.trim()).filter(Boolean),
        facilities: form.facilities.split(',').map((s) => s.trim()).filter(Boolean),
        ranksToggle: form.ranksToggle,
        defaultLanguage: form.defaultLanguage || null,
        defaultCurrency: form.defaultCurrency || null,
        timezone: form.timezone || null,
        description: form.description || null,
        classCancellationPolicy: form.classCancellationPolicy,
        waitlistClaimWindowMinutes: form.waitlistClaimWindowMinutes,
        checkInOpensMinutesBeforeStart: form.checkInOpensMinutesBeforeStart,
        lateCancelRefundPolicy: form.lateCancelRefundPolicy,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  if (isLoading || !form) return <Spinner />;
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('schools.profile.loadFailed')} />;

  return (
    <>
      <PageHeader title={t('schools.profile.title')} subtitle={school?.name} />
      <Card>
        <form onSubmit={handleSubmit}>
          {saveError ? <ErrorBanner message={saveError} /> : null}
          {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
          <Field label={t('schools.form.schoolName')} htmlFor="edit-name">
            <TextField required value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('schools.form.mobileNumber')} htmlFor="edit-mobile">
            <PhoneField value={form.mobileNumber} onChange={(v) => set('mobileNumber', v)} defaultCountry={guessDefaultCountry()} />
          </Field>
          <AddressFields
            idPrefix="edit-address"
            value={form.address}
            onChange={(v) => set('address', v)}
            errors={addressErrors}
            legacy={hasLegacyAddressOnly(school) && !form.address.country}
          />
          <Field label={t('schools.form.businessType')} htmlFor="edit-businessType">
            <TextField value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
          </Field>
          <Field label={t('schools.form.activities')} htmlFor="edit-activities" hint={t('schools.form.commaSeparated')}>
            <TextField value={form.activities} onChange={(e) => set('activities', e.target.value)} />
          </Field>
          <Field label={t('schools.form.facilities')} htmlFor="edit-facilities" hint={t('schools.form.commaSeparated')}>
            <TextField value={form.facilities} onChange={(e) => set('facilities', e.target.value)} />
          </Field>
          <Field label={t('schools.form.defaultLanguage')} htmlFor="edit-language">
            <SelectField
              id="edit-language"
              value={form.defaultLanguage}
              onChange={(e) => set('defaultLanguage', e.target.value)}
              options={[{ value: '', label: t('schools.form.notSet') }, ...(languages ?? []).map((l) => ({ value: l.code, label: languageName(l.code, l.name) }))]}
            />
          </Field>
          <Field label={t('schools.form.defaultCurrency')} htmlFor="edit-currency">
            <CurrencyField
              id="edit-currency"
              value={form.defaultCurrency}
              onChange={(code) => set('defaultCurrency', code)}
              options={[{ code: '', name: t('schools.form.notSet') }, ...(currencies ?? [])]}
              placeholder={t('schools.form.notSet')}
            />
          </Field>
          <Field label={t('schools.form.timezone')} htmlFor="edit-timezone" hint={t('schools.form.timezoneHint')}>
            <TimezoneField value={form.timezone} onChange={(timezone) => set('timezone', timezone)} />
          </Field>
          <Field label={t('schools.form.description')} htmlFor="edit-description">
            <TextField value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label={t('schools.form.cancellationPolicy')} htmlFor="edit-policy">
            <SelectField
              value={form.classCancellationPolicy}
              onChange={(e) => set('classCancellationPolicy', e.target.value as typeof form.classCancellationPolicy)}
              options={[
                { value: 'MANUAL', label: t('schools.form.policyManual') },
                { value: 'AUTO_REFUND', label: t('schools.form.policyAutoRefund') },
                { value: 'AUTO_CREDIT', label: t('schools.form.policyAutoCredit') },
              ]}
            />
          </Field>
          <Field label={t('schools.form.waitlistWindow')} htmlFor="edit-waitlist">
            <TextField
              type="number"
              min={1}
              value={form.waitlistClaimWindowMinutes}
              onChange={(e) => set('waitlistClaimWindowMinutes', Number(e.target.value))}
            />
          </Field>
          <Field label={t('schools.form.checkInOpens')} htmlFor="edit-checkin-opens" hint={t('schools.form.checkInOpensHint')}>
            <TextField
              type="number"
              min={0}
              max={1440}
              required
              value={form.checkInOpensMinutesBeforeStart}
              onChange={(e) => set('checkInOpensMinutesBeforeStart', Number(e.target.value))}
            />
          </Field>
          <Field label={t('schools.form.lateCancel')} htmlFor="edit-late-cancel" hint={t('schools.form.lateCancelHint')}>
            <SelectField
              value={form.lateCancelRefundPolicy}
              onChange={(e) => set('lateCancelRefundPolicy', e.target.value as typeof form.lateCancelRefundPolicy)}
              options={[
                { value: 'NO_REFUND_ONCE_STARTED', label: t('schools.form.lateCancelNoRefund') },
                { value: 'REFUND_UNTIL_END', label: t('schools.form.lateCancelRefundUntilEnd') },
                { value: 'ALWAYS_REFUND', label: t('schools.form.lateCancelAlwaysRefund') },
              ]}
            />
          </Field>
          <Checkbox
            label={t('schools.form.ranksToggle')}
            checked={form.ranksToggle}
            onChange={(e) => set('ranksToggle', e.target.checked)}
          />
          <div style={{ marginTop: 16 }}>
            <Button type="submit" loading={updateSchool.isPending}>
              {t('schools.profile.saveChanges')}
            </Button>
          </div>
        </form>
      </Card>
      {schoolId && school ? <FooterSettingsCard schoolId={schoolId} school={school} /> : null}
      {schoolId && school ? <FranchiseAffiliationCard schoolId={schoolId} franchiseId={school.franchiseId ?? null} /> : null}
    </>
  );
}

/**
 * Decision 257 — the content behind the School Portal's own richer footer
 * (`layout/SchoolFooter.tsx`): About us, Contact, and social links. A
 * separate Card/form from the main one above, same pattern as
 * FranchiseAffiliationCard below — its own local state, own save action, not
 * folded into the single giant form/save button. Every field is optional and
 * independently clearable; blank means "hide this line/icon on the footer
 * entirely," not "show nothing" or a placeholder (the product owner's own
 * explicit instruction) — `|| null` on submit, same convention the main form
 * above already uses for its own optional fields.
 */
function FooterSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const updateFooter = useUpdateSchool(schoolId);
  const [form, setForm] = useState({
    footerAboutUs: school.footerAboutUs ?? '',
    footerContactEmail: school.footerContactEmail ?? '',
    footerContactPhone: school.footerContactPhone ?? '',
    footerFacebookUrl: school.footerFacebookUrl ?? '',
    footerInstagramUrl: school.footerInstagramUrl ?? '',
    footerTiktokUrl: school.footerTiktokUrl ?? '',
    footerYoutubeUrl: school.footerYoutubeUrl ?? '',
    footerTwitterUrl: school.footerTwitterUrl ?? '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    try {
      await updateFooter.mutateAsync({
        footerAboutUs: form.footerAboutUs || null,
        footerContactEmail: form.footerContactEmail || null,
        footerContactPhone: form.footerContactPhone || null,
        footerFacebookUrl: form.footerFacebookUrl || null,
        footerInstagramUrl: form.footerInstagramUrl || null,
        footerTiktokUrl: form.footerTiktokUrl || null,
        footerYoutubeUrl: form.footerYoutubeUrl || null,
        footerTwitterUrl: form.footerTwitterUrl || null,
      });
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('schools.footerSettings.title')}
      </h2>
      <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13, marginBottom: 12 }}>
        {t('schools.footerSettings.explanation')}
      </p>
      <form onSubmit={handleSubmit}>
        {saveError ? <ErrorBanner message={saveError} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Field label={t('schools.footerSettings.aboutUs')} htmlFor="footer-about">
          <TextArea id="footer-about" rows={3} value={form.footerAboutUs} onChange={(e) => set('footerAboutUs', e.target.value)} />
        </Field>
        <Field label={t('schools.footerSettings.contactEmail')} htmlFor="footer-email">
          <TextField id="footer-email" type="email" value={form.footerContactEmail} onChange={(e) => set('footerContactEmail', e.target.value)} />
        </Field>
        <Field label={t('schools.footerSettings.contactPhone')} htmlFor="footer-phone">
          <PhoneField value={form.footerContactPhone} onChange={(v) => set('footerContactPhone', v)} defaultCountry={guessDefaultCountry()} />
        </Field>
        <Field label={t('schools.footerSettings.facebookUrl')} htmlFor="footer-fb">
          <TextField id="footer-fb" value={form.footerFacebookUrl} onChange={(e) => set('footerFacebookUrl', e.target.value)} placeholder="https://facebook.com/..." />
        </Field>
        <Field label={t('schools.footerSettings.instagramUrl')} htmlFor="footer-ig">
          <TextField id="footer-ig" value={form.footerInstagramUrl} onChange={(e) => set('footerInstagramUrl', e.target.value)} placeholder="https://instagram.com/..." />
        </Field>
        <Field label={t('schools.footerSettings.tiktokUrl')} htmlFor="footer-tt">
          <TextField id="footer-tt" value={form.footerTiktokUrl} onChange={(e) => set('footerTiktokUrl', e.target.value)} placeholder="https://tiktok.com/@..." />
        </Field>
        <Field label={t('schools.footerSettings.youtubeUrl')} htmlFor="footer-yt">
          <TextField id="footer-yt" value={form.footerYoutubeUrl} onChange={(e) => set('footerYoutubeUrl', e.target.value)} placeholder="https://youtube.com/@..." />
        </Field>
        <Field label={t('schools.footerSettings.twitterUrl')} htmlFor="footer-x">
          <TextField id="footer-x" value={form.footerTwitterUrl} onChange={(e) => set('footerTwitterUrl', e.target.value)} placeholder="https://x.com/..." />
        </Field>
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={updateFooter.isPending}>
            {t('schools.profile.saveChanges')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Decision 232 — leave/switch-Franchise, on top of Decision 98's own one-way-only
 * join-franchise endpoint. "Switch" is deliberately not a separate action here
 * either — leaving, then joining a different Franchise, same as the backend
 * (SchoolsService.leaveFranchise's own header comment). No "browse Franchises to
 * join" UI exists anywhere in this codebase (join-franchise never had one before
 * this phase) — a School Owner enters the Franchise's id directly, same shape the
 * API itself has always taken.
 */
function FranchiseAffiliationCard({ schoolId, franchiseId }: { schoolId: string; franchiseId: string | null }) {
  const t = useT();
  const joinFranchise = useJoinFranchise(schoolId);
  const leaveFranchise = useLeaveFranchise(schoolId);
  // Decision 346 — the Franchise's name and logo show only when both owners allow it.
  const updateSchool = useUpdateSchool(schoolId);
  const { data: branding } = useSchoolFranchiseBranding(franchiseId ? schoolId : null);
  const [franchiseIdInput, setFranchiseIdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Decision 337 (F6) — Leave asks first: it ends the School's franchise-fee billing.
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await joinFranchise.mutateAsync(franchiseIdInput);
      setFranchiseIdInput('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  async function handleShowBranding(showFranchiseBranding: boolean) {
    setError(null);
    try {
      await updateSchool.mutateAsync({ showFranchiseBranding });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  async function handleLeave() {
    setError(null);
    setConfirmingLeave(false);
    try {
      await leaveFranchise.mutateAsync();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('schools.franchise.title')}
      </h2>
      {error ? <ErrorBanner message={error} /> : null}
      {franchiseId ? (
        <>
          <p>
            <Trans k="schools.franchise.affiliatedWith" nodes={{ id: <Badge>{franchiseId}</Badge> }} />
          </p>
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
            {t('schools.franchise.leaveExplanation')}
          </p>
          {branding ? (
            <div style={{ marginBottom: 16 }}>
              <Switch
                id="school-show-franchise-branding"
                label={t('schools.franchise.showBrandingLabel')}
                description={t('schools.franchise.showBrandingHint')}
                checked={branding.schoolShows}
                disabled={updateSchool.isPending}
                onChange={handleShowBranding}
              />
              {!branding.franchiseAllows ? (
                <p className="ultm8-field__hint" data-testid="franchise-branding-not-allowed">
                  {t('schools.franchise.brandingNotAllowed')}
                </p>
              ) : branding.name ? (
                <p style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-testid="franchise-branding-preview">
                  {branding.logoUrl ? <img src={branding.logoUrl} alt="" width={24} height={24} style={{ objectFit: 'contain' }} /> : null}
                  {t('schools.franchise.partOf', { name: branding.name })}
                </p>
              ) : null}
            </div>
          ) : null}
          <Button variant="danger" onClick={() => setConfirmingLeave(true)} loading={leaveFranchise.isPending}>
            {t('schools.franchise.leave')}
          </Button>
          {confirmingLeave ? (
            <Modal title={t('schools.franchise.leaveConfirmTitle')} onClose={() => setConfirmingLeave(false)}>
              <p>{t('schools.franchise.leaveConfirmBody')}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <Button variant="danger" onClick={handleLeave}>
                  {t('schools.franchise.leave')}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmingLeave(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </Modal>
          ) : null}
        </>
      ) : (
        <>
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
            {t('schools.franchise.independent')}
          </p>
          <form onSubmit={handleJoin}>
            <Field label={t('schools.franchise.franchiseId')} htmlFor="join-franchise-id">
              <TextField required value={franchiseIdInput} onChange={(e) => setFranchiseIdInput(e.target.value)} />
            </Field>
            <Button type="submit" loading={joinFranchise.isPending}>
              {t('schools.franchise.join')}
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}
