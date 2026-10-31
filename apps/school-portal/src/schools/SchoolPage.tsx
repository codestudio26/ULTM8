import React, { useEffect, useState } from 'react';
import { AddressFields, Badge, Button, Card, Checkbox, CurrencyField, ErrorBanner, Field, Modal, PageHeader, PhoneField, PhotoUploadField, SelectField, Spinner, SuccessBanner, Switch, Table, TextArea, TextField, TimezoneField, hasLegacyAddressOnly, postalAddressFromRecord, preparePostalAddress, type PostalAddress, type PostalAddressErrors } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useLocation, useSearchParams } from 'react-router-dom';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useCurrencies, useLanguages } from '../settings/settingsQueries';
import {
  useCancelFranchiseJoinRequest,
  useCloseSchool,
  useFranchisePreview,
  useJoinFranchise,
  useLeaveFranchise,
  useRegenerateJoinCode,
  useSchool,
  useSchoolFeeCharges,
  useSchoolFranchiseBranding,
  useSchoolFranchiseFeeCard,
  useSchoolFranchiseJoinRequest,
  useStartFranchiseFeeCardSetup,
  useUpdateSchool,
  type FranchiseFeeCharge,
  type SchoolResponse,
} from './schoolQueries';
import { HeardFromCard } from './HeardFromCard';
import { StudentTagsSettingsCard } from './StudentTagsSettingsCard';
import { CustomMemberFieldsSettingsCard } from './CustomMemberFieldsSettingsCard';
import { FreezeSettingsCard } from './FreezeSettingsCard';
import { ChargeSettingsCard } from '../charges/ChargeSettingsCard';
import { CardSurchargeCard } from './CardSurchargeCard';
import { LateFeesCard } from '../charges/LateFeesCard';
import { useT } from '../i18n/I18nProvider';
import { formatLocale, languageName } from '../i18n/format';
import { Trans } from '../i18n/Trans';
import { CancellationSettingsFields, cancellationSettingsForm, cancellationSettingsPayload, isCancellationSettingsValid } from '../cancellations/CancellationSettingsFields';

/** Stripe's card brand ("visa", "mastercard") as shown: "Visa", "Mastercard". */
const cardBrand = (brand: string) => brand.charAt(0).toUpperCase() + brand.slice(1);
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';

/** School Owner/Manager's own School profile — view + update (Spec §8.2: "Manage
 * their own School"). Each card has its own form and Save, and each is keyed by
 * the School's id, so switching School in the header starts every card afresh
 * (Decision 368, S1 — the cards used to keep the previous School's values, and
 * saving wrote them onto the new one). Once the School is closed the whole page
 * is read-only (S4): every write is refused by then (Decision 110). */
export function SchoolPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const { data: school, isLoading, error: loadError } = useSchool(schoolId);
  // A link to one setting ("/school#edit-currency", Decision 414 item 6)
  // brings it into view once the page has loaded, and puts the cursor in it.
  const { hash } = useLocation();
  const loaded = !!school;
  useEffect(() => {
    if (!loaded || !hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView({ block: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus();
  }, [loaded, hash]);

  // Decision 368 (S7) — a Branch Staff member or Instructor has no owned School;
  // the query never runs, so this used to spin for ever.
  if (!schoolId) {
    return (
      <>
        <PageHeader title={t('schools.profile.title')} />
        <Card>
          <p data-testid="school-owners-only">{t('schools.profile.ownersOnly')}</p>
        </Card>
      </>
    );
  }
  // The error first: with no School loaded there is nothing for the spinner to wait for.
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('schools.profile.loadFailed')} />;
  if (isLoading || !school) return <Spinner />;

  const closed = !!school.archivedAt;
  return (
    <>
      <PageHeader title={t('schools.profile.title')} subtitle={school.name} />
      {closed ? <ClosedSchoolNotice school={school} /> : null}
      <fieldset disabled={closed} data-testid="school-settings" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SchoolDetailsCard key={schoolId} schoolId={schoolId} school={school} />
        {closed ? null : <JoinCodeCard key={`join-${schoolId}`} schoolId={schoolId} joinCode={school.joinCode} />}
        <CancellationSettingsCard key={`cancel-${schoolId}`} schoolId={schoolId} school={school} />
        {/* Decision 404: freezing memberships. */}
        <FreezeSettingsCard key={`freeze-${schoolId}`} schoolId={schoolId} school={school} />
        {/* Decision 411: tax on staff-created charges, set by the School. */}
        <ChargeSettingsCard key={`charges-${schoolId}`} schoolId={schoolId} school={school} />
        {/* Decision 406: only where the School's country allows it. */}
        <CardSurchargeCard key={`surcharge-${schoolId}`} schoolId={schoolId} />
        {/* Decision 413: late fees, off by default, the School's choice. */}
        <LateFeesCard key={`late-fees-${schoolId}`} schoolId={schoolId} />
        {/* Decision 392: the tablet sign-up's "How did you hear about us?" list. */}
        <HeardFromCard key={`heard-${schoolId}`} schoolId={schoolId} school={school} />
        {/* Backlog 5.4: the School's own student tags. */}
        <StudentTagsSettingsCard key={`tags-${schoolId}`} schoolId={schoolId} />
        {/* Decision 315 item 14: the School's own member fields and statuses. */}
        <CustomMemberFieldsSettingsCard key={`custom-fields-${schoolId}`} schoolId={schoolId} />
        <FooterSettingsCard key={`footer-${schoolId}`} schoolId={schoolId} school={school} />
        <FranchiseAffiliationCard key={`franchise-${schoolId}`} schoolId={schoolId} franchiseId={school.franchiseId ?? null} closed={closed} />
      </fieldset>
      {closed ? null : <CloseSchoolCard key={`close-${schoolId}`} schoolId={schoolId} school={school} />}
    </>
  );
}

type DetailsForm = {
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
  logoUrl: string;
  accentColor: string;
  waitlistClaimWindowMinutes: string;
  checkInOpensMinutesBeforeStart: string;
  checkInCodeDigits: 4 | 6;
  visitorPeriodDays: string;
  absenceAlertWeeks: string;
  branchStaffCanRecordPayments: boolean;
  weekStartsOn: 'MONDAY' | 'SUNDAY';
  timetableDefaultLayout: 'LIST' | 'GRID';
};

function detailsForm(school: SchoolResponse, address: PostalAddress): DetailsForm {
  return {
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
    logoUrl: school.logoUrl ?? '',
    accentColor: school.accentColor ?? '',
    waitlistClaimWindowMinutes: String(school.waitlistClaimWindowMinutes),
    checkInOpensMinutesBeforeStart: String(school.checkInOpensMinutesBeforeStart),
    checkInCodeDigits: school.checkInCodeDigits === 6 ? 6 : 4,
    visitorPeriodDays: school.visitorPeriodDays ? String(school.visitorPeriodDays) : '',
    absenceAlertWeeks: school.absenceAlertWeeks ? String(school.absenceAlertWeeks) : '',
    branchStaffCanRecordPayments: school.branchStaffCanRecordPayments,
    weekStartsOn: school.weekStartsOn,
    timetableDefaultLayout: school.timetableDefaultLayout,
  };
}

/** The School's own details, in three headed groups (Decision 368, Q5 — visual
 * only, still one Save). The form is filled once per School and after its own
 * Save, never on a background reload (S2: saving another card used to wipe
 * what was typed here). */
function SchoolDetailsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const updateSchool = useUpdateSchool(schoolId);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();
  const { data: languages } = useLanguages();
  const { data: currencies } = useCurrencies();
  const [initialAddress, setInitialAddress] = useState(() => postalAddressFromRecord(school, guessDefaultCountry()));
  const [form, setForm] = useState<DetailsForm>(() => detailsForm(school, initialAddress));
  const [addressErrors, setAddressErrors] = useState<PostalAddressErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Decision 368 (Q3) — the API's message, shown in the confirm step.
  const [currencyConfirm, setCurrencyConfirm] = useState<string | null>(null);

  function set<K extends keyof DetailsForm>(key: K, value: DetailsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(confirmCurrencyChange: boolean) {
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
      const updated = await updateSchool.mutateAsync({
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
        logoUrl: form.logoUrl || null,
        accentColor: form.accentColor || null,
        waitlistClaimWindowMinutes: Number(form.waitlistClaimWindowMinutes),
        checkInOpensMinutesBeforeStart: Number(form.checkInOpensMinutesBeforeStart),
        checkInCodeDigits: form.checkInCodeDigits,
        visitorPeriodDays: form.visitorPeriodDays.trim() === '' ? null : Number(form.visitorPeriodDays),
        absenceAlertWeeks: form.absenceAlertWeeks.trim() === '' ? null : Number(form.absenceAlertWeeks),
        branchStaffCanRecordPayments: form.branchStaffCanRecordPayments,
        weekStartsOn: form.weekStartsOn,
        timetableDefaultLayout: form.timetableDefaultLayout,
        ...(confirmCurrencyChange ? { confirmCurrencyChange: true } : {}),
      });
      const address = postalAddressFromRecord(updated, guessDefaultCountry());
      setInitialAddress(address);
      setForm(detailsForm(updated, address));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SCHOOL_CURRENCY_CHANGE_CONFIRM') {
        setCurrencyConfirm(err.message);
        return;
      }
      setSaveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void save(false);
  }

  return (
    <Card>
      <form onSubmit={handleSubmit}>
        {saveError ? <ErrorBanner message={saveError} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{t('schools.profile.groupProfile')}</h2>
        <Field label={t('schools.form.schoolName')} htmlFor="edit-name">
          <TextField required maxLength={100} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('schools.form.logo')} htmlFor="edit-logo" hint={t('schools.form.logoHint')}>
          <PhotoUploadField
            value={form.logoUrl}
            onChange={(logoUrl) => set('logoUrl', logoUrl)}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({ entityType: 'SCHOOL', schoolId, entityId: schoolId, contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' })
            }
          />
        </Field>
        <Field label={t('schools.form.accentColour')} htmlFor="edit-accent" hint={t('schools.form.accentColourHint')}>
          <ColourInput value={form.accentColor} onChange={(v) => set('accentColor', v)} />
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
          <TextField maxLength={100} value={form.businessType} onChange={(e) => set('businessType', e.target.value)} />
        </Field>
        <Field label={t('schools.form.activities')} htmlFor="edit-activities" hint={t('schools.form.commaSeparated')}>
          <TextField value={form.activities} onChange={(e) => set('activities', e.target.value)} />
        </Field>
        <Field label={t('schools.form.facilities')} htmlFor="edit-facilities" hint={t('schools.form.commaSeparated')}>
          <TextField value={form.facilities} onChange={(e) => set('facilities', e.target.value)} />
        </Field>
        <Field label={t('schools.form.description')} htmlFor="edit-description">
          <TextField maxLength={500} value={form.description} onChange={(e) => set('description', e.target.value)} />
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

        <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>{t('schools.profile.groupBookings')}</h2>
        <Field label={t('schools.form.waitlistWindow')} htmlFor="edit-waitlist">
          <TextField
            type="number"
            min={1}
            step={1}
            required
            value={form.waitlistClaimWindowMinutes}
            onChange={(e) => set('waitlistClaimWindowMinutes', e.target.value)}
          />
        </Field>
        <Field label={t('schools.form.checkInOpens')} htmlFor="edit-checkin-opens" hint={t('schools.form.checkInOpensHint')}>
          <TextField
            type="number"
            min={0}
            max={1440}
            step={1}
            required
            value={form.checkInOpensMinutesBeforeStart}
            onChange={(e) => set('checkInOpensMinutesBeforeStart', e.target.value)}
          />
        </Field>
        {/* Decision 380: how long the codes ULTM8 makes here are (staff codes for the front-desk tablet). */}
        <Field label={t('schools.form.checkInCodeDigits')} htmlFor="edit-checkin-code-digits" hint={t('schools.form.checkInCodeDigitsHint')}>
          <SelectField
            id="edit-checkin-code-digits"
            value={String(form.checkInCodeDigits)}
            onChange={(e) => set('checkInCodeDigits', e.target.value === '6' ? 6 : 4)}
            options={[
              { value: '4', label: t('schools.form.checkInCodeDigits4') },
              { value: '6', label: t('schools.form.checkInCodeDigits6') },
            ]}
          />
        </Field>
        {/* Decision 391: how long a Visitor's free visit pass lasts. No default. */}
        <Field label={t('schools.form.visitorPeriod')} htmlFor="edit-visitor-period" hint={t('schools.form.visitorPeriodHint')}>
          <TextField
            id="edit-visitor-period"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={form.visitorPeriodDays}
            onChange={(e) => set('visitorPeriodDays', e.target.value)}
          />
        </Field>
        {/* Decision 317 item 7: staff are told when a member hasn't checked in for this many weeks. Empty: off. */}
        <Field label={t('schools.form.absenceAlertWeeks')} htmlFor="edit-absence-alert-weeks" hint={t('schools.form.absenceAlertWeeksHint')}>
          <TextField
            id="edit-absence-alert-weeks"
            type="number"
            min={1}
            max={52}
            step={1}
            value={form.absenceAlertWeeks}
            onChange={(e) => set('absenceAlertWeeks', e.target.value)}
          />
        </Field>
        {/* Decision 319 §4 (Decision 353, Q8): how the Timetable opens. */}
        <Field label={t('schools.form.weekStart')} htmlFor="edit-week-start">
          <SelectField
            id="edit-week-start"
            value={form.weekStartsOn}
            onChange={(e) => set('weekStartsOn', e.target.value as DetailsForm['weekStartsOn'])}
            options={[
              { value: 'MONDAY', label: t('schools.form.weekStartMonday') },
              { value: 'SUNDAY', label: t('schools.form.weekStartSunday') },
            ]}
          />
        </Field>
        <Field label={t('schools.form.timetableLayout')} htmlFor="edit-timetable-layout">
          <SelectField
            id="edit-timetable-layout"
            value={form.timetableDefaultLayout}
            onChange={(e) => set('timetableDefaultLayout', e.target.value as DetailsForm['timetableDefaultLayout'])}
            options={[
              { value: 'LIST', label: t('schools.form.layoutList') },
              { value: 'GRID', label: t('schools.form.layoutGrid') },
            ]}
          />
        </Field>

        <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>{t('schools.profile.groupStaff')}</h2>
        <Checkbox
          label={t('schools.form.ranksToggle')}
          checked={form.ranksToggle}
          onChange={(e) => set('ranksToggle', e.target.checked)}
        />
        {/* Decision 347: off by default; Branch Staff still never see the ledger. */}
        <Checkbox
          label={t('schools.form.branchStaffPayments')}
          checked={form.branchStaffCanRecordPayments}
          onChange={(e) => set('branchStaffCanRecordPayments', e.target.checked)}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={updateSchool.isPending}>
            {t('schools.profile.saveChanges')}
          </Button>
        </div>
      </form>
      {currencyConfirm ? (
        <Modal title={t('schools.form.currencyConfirmTitle')} onClose={() => setCurrencyConfirm(null)}>
          <p data-testid="currency-confirm-body">{currencyConfirm}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              loading={updateSchool.isPending}
              onClick={async () => {
                await save(true);
                setCurrencyConfirm(null);
              }}
            >
              {t('schools.form.currencyConfirmButton')}
            </Button>
            <Button variant="secondary" onClick={() => setCurrencyConfirm(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

/** Decision 368 (Q2) — the School's colour for the student app (School.accentColor,
 * Decision 266): a colour picker and its hex code, or blank for the app's own colour.
 * `Field` hands it the id and aria props. */
function ColourInput({ value, onChange, ...inputProps }: { value: string; onChange: (value: string) => void; id?: string; 'aria-describedby'?: string }) {
  const t = useT();
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <TextField
        {...inputProps}
        type="color"
        value={valid ? value : '#1a73e8'}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 56, padding: 2 }}
      />
      <span data-testid="accent-colour-value">{valid ? value.toUpperCase() : t('schools.form.accentColourDefault')}</span>
      {value ? (
        <Button variant="secondary" onClick={() => onChange('')}>
          {t('schools.form.accentColourClear')}
        </Button>
      ) : null}
    </div>
  );
}

/** Decision 368 (S4) — a closed School's page is read-only; this says why, at the top. */
function ClosedSchoolNotice({ school }: { school: SchoolResponse }) {
  const t = useT();
  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('schools.close.closedTitle')}
      </h2>
      <p data-testid="school-closed-notice">
        {t('schools.close.closedBody', { date: school.purgeAt ? new Date(school.purgeAt).toLocaleDateString(formatLocale()) : '—' })}
      </p>
    </Card>
  );
}

/** Decision 368 (Q1) — the join code students type in the app to find and join
 * this School (Decision 266), with Copy and "Make a new code", which asks first:
 * the old code stops working at once. */
function JoinCodeCard({ schoolId, joinCode }: { schoolId: string; joinCode: string }) {
  const t = useT();
  const regenerate = useRegenerateJoinCode(schoolId);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function handleRegenerate() {
    setError(null);
    try {
      await regenerate.mutateAsync();
      setCopied(false);
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('schools.joinCode.title')}
      </h2>
      <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('schools.joinCode.explanation')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <code data-testid="school-join-code" style={{ fontSize: 22, letterSpacing: 3, fontWeight: 600 }}>
          {joinCode}
        </code>
        <Button variant="secondary" onClick={handleCopy}>
          {copied ? t('schools.joinCode.copied') : t('schools.joinCode.copy')}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          {t('schools.joinCode.regenerate')}
        </Button>
      </div>
      {confirming ? (
        <Modal title={t('schools.joinCode.regenerateConfirmTitle')} onClose={() => setConfirming(false)}>
          <p>{t('schools.joinCode.regenerateConfirmBody')}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button onClick={handleRegenerate} loading={regenerate.isPending}>
              {t('schools.joinCode.regenerate')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

/** Decision 364 — the School Owner closes their own School: the name re-typed
 * plus their passcode, the same 90-day close as Decision 110's. Once closed,
 * ClosedSchoolNotice says when the School is deleted and who can reopen it. */
function CloseSchoolCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const close = useCloseSchool(schoolId);
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await close.mutateAsync({ confirmName, passcode });
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('schools.close.title')}
      </h2>
      <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('schools.close.explanation')}</p>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('schools.close.button')}
      </Button>
      {open ? (
        <Modal title={t('schools.close.confirmTitle')} onClose={() => setOpen(false)}>
          <form onSubmit={handleSubmit}>
            <p>{t('schools.close.confirmBody')}</p>
            {error ? <ErrorBanner message={error} /> : null}
            <Field label={t('schools.close.nameLabel', { name: school.name })} htmlFor="close-school-name">
              <TextField id="close-school-name" required value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
            </Field>
            <Field label={t('schools.close.passcodeLabel')} htmlFor="close-school-passcode">
              <TextField
                id="close-school-passcode"
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button type="submit" variant="danger" loading={close.isPending} disabled={confirmName !== school.name}>
                {t('schools.close.button')}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Card>
  );
}

/**
 * Decision 291 — the owner's "Class cancellations" settings: what a cancelled
 * booking gets back, when that applies, the late and no-show fees, and what
 * happens when the School cancels a whole class. Its own Card and save, same
 * pattern as FooterSettingsCard below, so saving the main form never
 * overwrites these. Two rules are fixed and only explained here: a Friend Pass
 * always gets its credit back, and only an Owner/Manager can send money back.
 * Decision 292 — each Branch can override these on its own settings page.
 */
function CancellationSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [form, setForm] = useState(() => cancellationSettingsForm(school));
  // Decision 322's late-cancel setting, moved here from the School's details
  // (Decision 368, Q5). It's School-wide: Branches don't override it.
  const [lateCancelRefundPolicy, setLateCancelRefundPolicy] = useState(school.lateCancelRefundPolicy);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    if (!isCancellationSettingsValid(form)) return;
    try {
      await update.mutateAsync({ ...cancellationSettingsPayload(form), lateCancelRefundPolicy });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form id="cancellations" onSubmit={handleSubmit}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.cancellations.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.cancellations.subtitle')}</p>
        {/* Decision 292 — until the owner saves a policy, ask them to. */}
        {!school.cancellationPolicyChosenAt && !saved ? (
          <div className="ultm8-banner ultm8-banner--warning" role="status">
            <strong>{t('schools.cancellations.chooseTitle')}</strong> {t('schools.cancellations.chooseBody')}
          </div>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <CancellationSettingsFields form={form} onChange={setForm} currency={school.defaultCurrency} schoolCurrencyMissing={!school.defaultCurrency} />
        <Field
          label={t('schools.form.lateCancel')}
          htmlFor="edit-late-cancel"
          hint={`${t('schools.form.lateCancelHint')} ${t('schools.cancellations.lateCancelAllBranches')}`}
        >
          <SelectField
            value={lateCancelRefundPolicy}
            onChange={(e) => setLateCancelRefundPolicy(e.target.value as typeof lateCancelRefundPolicy)}
            options={[
              { value: 'NO_REFUND_ONCE_STARTED', label: t('schools.form.lateCancelNoRefund') },
              { value: 'REFUND_UNTIL_END', label: t('schools.form.lateCancelRefundUntilEnd') },
              { value: 'ALWAYS_REFUND', label: t('schools.form.lateCancelAlwaysRefund') },
            ]}
          />
        </Field>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>{t('schools.cancellations.branchHint')}</p>
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={update.isPending}>
            {t('schools.profile.saveChanges')}
          </Button>
        </div>
      </form>
    </Card>
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
    // Decision 368 (S5) — "instagram.com/x" becomes "https://instagram.com/x",
    // shown back in the box, so the footer icon opens the real page.
    const links = {
      footerFacebookUrl: withHttps(form.footerFacebookUrl),
      footerInstagramUrl: withHttps(form.footerInstagramUrl),
      footerTiktokUrl: withHttps(form.footerTiktokUrl),
      footerYoutubeUrl: withHttps(form.footerYoutubeUrl),
      footerTwitterUrl: withHttps(form.footerTwitterUrl),
    };
    setForm((f) => ({ ...f, ...links }));
    try {
      await updateFooter.mutateAsync({
        footerAboutUs: form.footerAboutUs.trim() || null,
        footerContactEmail: form.footerContactEmail.trim() || null,
        footerContactPhone: form.footerContactPhone || null,
        footerFacebookUrl: links.footerFacebookUrl || null,
        footerInstagramUrl: links.footerInstagramUrl || null,
        footerTiktokUrl: links.footerTiktokUrl || null,
        footerYoutubeUrl: links.footerYoutubeUrl || null,
        footerTwitterUrl: links.footerTwitterUrl || null,
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

/** A web address typed without its scheme gets https:// in front; blank stays blank. */
export function withHttps(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Decision 407 — the School pays its franchise fee by card. "Add card" opens
 * Stripe's own secure card form (hosted Checkout), which returns here with
 * `?franchiseCard=added` or `=cancelled`; the card is charged each month, and a
 * failed charge is retried by Stripe while the Owner gets a notice. Below it,
 * the School's fee charges: period, amount, and whether each was paid or failed.
 */
function FranchiseFeeSection({ schoolId, closed }: { schoolId: string; closed: boolean }) {
  const t = useT();
  const [searchParams] = useSearchParams();
  const returned = searchParams.get('franchiseCard');
  const { data: card, isLoading: cardLoading, error: cardError } = useSchoolFranchiseFeeCard(schoolId);
  const { data: chargeData, error: chargesError } = useSchoolFeeCharges(schoolId);
  const startSetup = useStartFranchiseFeeCardSetup(schoolId);
  const [error, setError] = useState<string | null>(null);
  const charges = [...(chargeData?.items ?? [])].sort((a, b) => b.billingPeriodStart.localeCompare(a.billingPeriodStart));

  async function handleAddCard() {
    setError(null);
    try {
      window.location.assign(await startSetup.mutateAsync());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <div style={{ marginTop: 24 }} data-testid="franchise-fee">
      <h3 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
        {t('schools.franchise.feeTitle')}
      </h3>
      {returned === 'added' ? <SuccessBanner message={t('schools.franchise.cardAdded')} /> : null}
      {returned === 'cancelled' ? <p className="ultm8-field__hint">{t('schools.franchise.cardCancelled')}</p> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {cardLoading ? (
        <Spinner />
      ) : cardError ? (
        <ErrorBanner message={cardError instanceof ApiError ? cardError.message : t('schools.franchise.cardLoadFailed')} />
      ) : card ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13, margin: 0 }}>{t('schools.franchise.feeExplanation')}</p>
          <p style={{ margin: 0 }} data-testid="franchise-fee-card">
            {card.hasCard
              ? card.brand && card.last4
                ? t('schools.franchise.cardOnFile', { brand: cardBrand(card.brand), last4: card.last4 })
                : t('schools.franchise.cardSaved')
              : t('schools.franchise.noCard')}
          </p>
          {!card.canAddCard ? (
            <p className="ultm8-field__hint" data-testid="franchise-fee-not-connected">
              {t('schools.franchise.franchiseNotConnected')}
            </p>
          ) : closed ? null : (
            <Button variant="secondary" onClick={handleAddCard} loading={startSetup.isPending}>
              {card.hasCard ? t('schools.franchise.updateCard') : t('schools.franchise.addCard')}
            </Button>
          )}
        </div>
      ) : null}

      <h3 className="ultm8-page-header__title" style={{ fontSize: 15, margin: '16px 0 8px' }}>
        {t('schools.franchise.chargesTitle')}
      </h3>
      {chargesError ? (
        <ErrorBanner message={chargesError instanceof ApiError ? chargesError.message : t('schools.franchise.chargesLoadFailed')} />
      ) : charges.length === 0 ? (
        <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('schools.franchise.noCharges')}</p>
      ) : (
        <Table<FranchiseFeeCharge>
          rows={charges}
          columns={[
            {
              key: 'period',
              header: t('schools.franchise.columnPeriod'),
              render: (c) => `${new Date(c.billingPeriodStart).toLocaleDateString(formatLocale())} – ${new Date(c.billingPeriodEnd).toLocaleDateString(formatLocale())}`,
            },
            { key: 'amount', header: t('schools.franchise.columnAmount'), render: (c) => formatMoney(c.amount, c.currency) },
            { key: 'status', header: t('schools.franchise.columnStatus'), render: (c) => paymentStatusBadge(c.status) },
          ]}
        />
      )}
    </div>
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
function FranchiseAffiliationCard({ schoolId, franchiseId, closed }: { schoolId: string; franchiseId: string | null; closed: boolean }) {
  const t = useT();
  const joinFranchise = useJoinFranchise(schoolId);
  // Decision 368 (Q4) — the Franchise's name, checked before the request goes out.
  const preview = useFranchisePreview(schoolId);
  const [confirmingJoin, setConfirmingJoin] = useState<{ id: string; name: string } | null>(null);
  const leaveFranchise = useLeaveFranchise(schoolId);
  // Decision 350 — the Franchise's name and logo show only when both owners allow it.
  const updateSchool = useUpdateSchool(schoolId);
  const { data: branding } = useSchoolFranchiseBranding(franchiseId ? schoolId : null);
  // Decision 352 — joining is a request the Franchise Owner accepts or declines.
  const { data: joinRequestData } = useSchoolFranchiseJoinRequest(franchiseId || closed ? null : schoolId);
  const cancelJoinRequest = useCancelFranchiseJoinRequest(schoolId);
  const joinRequest = joinRequestData?.request ?? null;
  const [franchiseIdInput, setFranchiseIdInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Decision 337 (F6) — Leave asks first: it ends the School's franchise-fee billing.
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setConfirmingJoin(await preview.mutateAsync(franchiseIdInput.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  async function handleJoin() {
    if (!confirmingJoin) return;
    setError(null);
    try {
      await joinFranchise.mutateAsync(confirmingJoin.id);
      setFranchiseIdInput('');
      setConfirmingJoin(null);
    } catch (err) {
      setConfirmingJoin(null);
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  async function handleCancelRequest() {
    setError(null);
    try {
      await cancelJoinRequest.mutateAsync();
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
          {branding && !closed ? (
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
          {closed ? null : (
            <Button variant="danger" onClick={() => setConfirmingLeave(true)} loading={leaveFranchise.isPending}>
              {t('schools.franchise.leave')}
            </Button>
          )}
          <FranchiseFeeSection schoolId={schoolId} closed={closed} />
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
          {closed ? null : joinRequest?.status === 'PENDING' ? (
            <div data-testid="franchise-join-pending">
              <p>
                <Trans k="schools.franchise.requestPending" nodes={{ id: <Badge>{joinRequest.franchiseId}</Badge> }} />
              </p>
              <Button variant="secondary" onClick={handleCancelRequest} loading={cancelJoinRequest.isPending}>
                {t('schools.franchise.cancelRequest')}
              </Button>
            </div>
          ) : (
            <>
              {joinRequest?.status === 'DECLINED' ? (
                <p className="ultm8-field__hint" data-testid="franchise-join-declined">
                  <Trans k="schools.franchise.requestDeclined" nodes={{ id: <Badge>{joinRequest.franchiseId}</Badge> }} />
                </p>
              ) : null}
              <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('schools.franchise.joinExplanation')}</p>
              <form onSubmit={handleCheck}>
                <Field label={t('schools.franchise.franchiseId')} htmlFor="join-franchise-id">
                  <TextField id="join-franchise-id" required value={franchiseIdInput} onChange={(e) => setFranchiseIdInput(e.target.value)} />
                </Field>
                <Button type="submit" loading={preview.isPending}>
                  {t('schools.franchise.join')}
                </Button>
              </form>
              {confirmingJoin ? (
                <Modal title={t('schools.franchise.confirmTitle')} onClose={() => setConfirmingJoin(null)}>
                  <p data-testid="franchise-join-confirm">{t('schools.franchise.confirmBody', { name: confirmingJoin.name })}</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <Button onClick={handleJoin} loading={joinFranchise.isPending}>
                      {t('schools.franchise.sendRequest')}
                    </Button>
                    <Button variant="secondary" onClick={() => setConfirmingJoin(null)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </Modal>
              ) : null}
            </>
          )}
        </>
      )}
    </Card>
  );
}
