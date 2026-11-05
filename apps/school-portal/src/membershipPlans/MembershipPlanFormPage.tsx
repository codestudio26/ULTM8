import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Checkbox, CurrencyField, ErrorBanner, Field, PageHeader, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useCurrencies } from '../settings/settingsQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { isoToLocalInput, localInputToIso } from '../lib/datetime';
import { MoneyField } from '../lib/MoneyField';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import {
  useCreateMembershipPlan,
  useMembershipPlan,
  useMembershipPlanActiveCount,
  useMembershipPlans,
  useUpdateMembershipPlan,
  type MembershipPlanResponse,
} from './membershipPlanQueries';

/** Decision 435 items 7-9: the plan types that can start on the first
 * check-in, run on fixed dates, and switch at their end (and be switched to). */
const TERM_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'];
import { OwnerOnly } from './MembershipPlansPage';
import { PlanContractCard } from './PlanContractCard';
import { CurrencyFirstNotice } from '../lib/CurrencyFirstNotice';
import { incomeCategoryOptions, useIncomeCategories, type IncomeCategory } from '../charges/incomeCategoryQueries';

/** `label`/`caption` are translation keys, resolved at render time; `value`
 * is the enum value sent to the API, never translated. */
const PLAN_TYPES = [
  { value: 'SUBSCRIPTION', label: 'membershipPlans.types.subscription', caption: 'membershipPlans.form.typeCaptions.subscription' },
  { value: 'CLASS_PACK', label: 'membershipPlans.types.classPack', caption: 'membershipPlans.form.typeCaptions.classPack' },
  { value: 'WEEKLY_PASS', label: 'membershipPlans.types.weeklyPass', caption: 'membershipPlans.form.typeCaptions.weeklyPass' },
  { value: 'FRIEND_PASS', label: 'membershipPlans.types.friendPass', caption: 'membershipPlans.form.typeCaptions.friendPass' },
  { value: 'TRIAL_MEMBERSHIP', label: 'membershipPlans.types.trialMembership', caption: 'membershipPlans.form.typeCaptions.trialMembership' },
] as const satisfies ReadonlyArray<{ value: string; label: TranslationKey; caption: TranslationKey }>;

type PlanType = (typeof PLAN_TYPES)[number]['value'];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
      {children}
    </h2>
  );
}

// Wizard steps — one per existing section, same order. Each step's Card is
// rendered alone when active (conditional mounting), not all stacked, with a
// clickable pill row to jump directly to any step — not strictly linear,
// since an Edit shouldn't require clicking Next four times to reach one
// field. Kept page-local rather than promoted to @ultm8/ui: no Stepper/
// Wizard primitive exists anywhere in this codebase yet, same "don't invent
// a shared design-system primitive for one page" precedent Decision 201
// already set for a Toggle/Switch control.
const STEPS: ReadonlyArray<{ label: TranslationKey }> = [
  { label: 'membershipPlans.form.steps.basics' },
  { label: 'membershipPlans.form.steps.pricingAccess' },
  { label: 'membershipPlans.form.steps.policies' },
  { label: 'membershipPlans.form.steps.disciplinesLessons' },
  { label: 'membershipPlans.form.steps.visibility' },
];

export function MembershipPlanFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const schoolId = useOwnedSchoolId();
  const { data: school } = useSchool(schoolId);
  const { data: classData } = useClasses(schoolId);
  // Archived styles too: the forms show one a record already has (Decision 310).
  const { data: disciplineData } = useDisciplines(schoolId, { includeArchived: true });
  const { data: existingPlan, isLoading: planLoading, error: planError } = useMembershipPlan(id ?? null);
  // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
  // prompt. Fetched eagerly (not just on submit attempt) so the prompt can
  // render as soon as the price field actually changes, rather than only
  // surfacing after a 400 from the server — only ever relevant on Edit, so
  // `null` on Create skips the request entirely (useQuery's own `enabled`).
  const { data: activeCountData } = useMembershipPlanActiveCount(isEdit ? id ?? null : null);
  // Decision 316 item 10: the School's income categories for the picker.
  const { data: incomeCategoryData } = useIncomeCategories(schoolId);
  // Decision 435 item 9: the plans this one can switch to when it ends.
  const { data: planData } = useMembershipPlans(schoolId);
  const createPlan = useCreateMembershipPlan(schoolId ?? '');
  const updatePlan = useUpdateMembershipPlan(schoolId ?? '', id ?? '');
  const t = useT();

  if (!schoolId) return <OwnerOnly />;
  if (isEdit && planLoading) return <Spinner />;
  if (isEdit && planError) {
    return <ErrorBanner message={planError instanceof ApiError ? planError.message : t('membershipPlans.form.loadFailed')} />;
  }
  if (isEdit && !existingPlan) return null;

  // Duplicate (list page's row action) navigates here with the source plan's
  // values as router state — closes the "Duplicate" backlog gap client-side,
  // no new backend endpoint (docs/v1.2-backend-backlog.md's own suggested
  // alternative).
  const duplicateFrom = !isEdit
    ? (location.state as { duplicateFrom?: Partial<MembershipPlanResponse> } | null)?.duplicateFrom
    : undefined;
  const initial = isEdit ? existingPlan : duplicateFrom;

  return (
    <>
    <MembershipPlanForm
      mode={isEdit ? 'edit' : 'create'}
      initial={initial}
      classes={classData?.items ?? []}
      disciplines={disciplineData?.items ?? []}
      incomeCategories={incomeCategoryData?.items ?? []}
      switchTargets={(planData?.items ?? []).filter(
        (p) => p.id !== id && !p.archivedAt && p.price > 0 && p.contractVersion == null && TERM_TYPES.includes(p.type),
      )}
      defaultCurrency={school?.defaultCurrency ?? undefined}
      // Decision 414 item 6: no price until the School's currency is set.
      schoolCurrencyMissing={!!school && !school.defaultCurrency}
      // Memberships review M9 (Decision 334): the migrate-or-keep prompt is
      // about running subscriptions, the same count the API checks; active
      // members (cash Weekly Passes etc.) only lock the type (M14).
      activeSubscriberCount={activeCountData?.subscriberCount ?? 0}
      activeMemberCount={activeCountData?.activeCount ?? 0}
      submitting={isEdit ? updatePlan.isPending : createPlan.isPending}
      onSubmit={async (values) => {
        if (isEdit) {
          await updatePlan.mutateAsync(values);
        } else {
          // Create has nothing to "clear" — map the form's nulls back to
          // undefined (omitted), since CreateMembershipPlanDto doesn't
          // accept null on these fields.
          await createPlan.mutateAsync(nullsToUndefined(values));
        }
        navigate('/membership-plans');
      }}
      onCancel={() => navigate('/membership-plans')}
    />
    {/* Decision 316 item 6: the plan's contract, saved on its own. */}
    {isEdit && existingPlan ? <PlanContractCard key={`${existingPlan.id}-${existingPlan.contractVersion ?? 0}`} plan={existingPlan} currency={school?.defaultCurrency} /> : null}
    </>
  );
}

interface MembershipPlanFormValues {
  type: PlanType;
  title: string;
  price: number;
  currency?: string | null;
  expiryDurationDays?: number | null;
  classesIncluded?: number;
  scopedClassId?: string | null;
  visible: boolean;
  refundFeeDate?: string | null;
  cancellationCharge?: number | null;
  termsWaiverRequired: boolean;
  disciplineIds: string[];
  includesLessons: boolean;
  // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
  // prompt. Only ever set (and only ever sent to the server) when editing a
  // SUBSCRIPTION plan whose price actually changed and which already has at
  // least one active subscriber — see requiresPriceChangeDecision below.
  // Omitted (undefined) on every other submit, including every Create.
  priceChangeStrategy?: 'MIGRATE' | 'GRANDFATHER';
  // Decision 259 — SUBSCRIPTION only. Omitted on every other type.
  newMemberBillingStrategy?: 'FRESH_CYCLE' | 'PRORATED_TO_SHARED_CYCLE';
  billingCycleAnchorDay?: number | null;
  // Decision 316 item 10. Null clears it on edit; omitted on create.
  incomeCategoryId?: string | null;
  // Decision 435 items 7-9. Days are YYYY-MM-DD; null clears.
  startsOnFirstCheckIn?: boolean;
  fixedStartDate?: string | null;
  fixedEndDate?: string | null;
  switchToPlanId?: string | null;
}

/** Fields match CreateMembershipPlanDto/UpdateMembershipPlanDto exactly —
 * apps/api/src/memberships/dto/create-membership-plan.dto.ts. Cross-field
 * rules (FRIEND_PASS forces price=0/classesIncluded=1, scopedClassId caps
 * classesIncluded at 1, SUBSCRIPTION needs a Stripe PaymentAccount) are
 * enforced server-side in MembershipsService — this form doesn't duplicate
 * that logic, only adds client-side guardrails (hiding/resetting fields a
 * selected type doesn't use) to catch an invalid combination before it's
 * attempted; a rejected combination still surfaces as a plain ApiError from
 * the save attempt. */
function MembershipPlanForm({
  mode,
  initial,
  classes,
  disciplines,
  incomeCategories,
  switchTargets = [],
  defaultCurrency,
  schoolCurrencyMissing = false,
  activeSubscriberCount,
  activeMemberCount,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<MembershipPlanResponse>;
  classes: ClassResponse[];
  disciplines: DisciplineResponse[];
  /** Decision 316 item 10: the School's income categories. */
  incomeCategories: IncomeCategory[];
  /** Decision 435 item 9: the plans this one can switch to when it ends. */
  switchTargets?: MembershipPlanResponse[];
  defaultCurrency?: string;
  /** Decision 414 item 6 — the School has no currency yet, so the price
   * fields are off (a free plan can still be saved) and a notice links to the
   * School page setting. */
  schoolCurrencyMissing?: boolean;
  /** v1.2 backend backlog — how many ACTIVE, Stripe-backed subscribers this
   * plan currently has. Always 0 on Create (nothing to migrate/grandfather
   * for a plan that doesn't exist yet). */
  activeSubscriberCount: number;
  /** Live members of this plan. While there are any, the API refuses a type
   * change (Memberships review M14), so the Type picker is locked. */
  activeMemberCount: number;
  submitting: boolean;
  onSubmit: (values: MembershipPlanFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  // Real confirmed-list selection via GET /settings/currencies (now every
  // Stripe-supported currency, ~135 ISO 4217 codes, up from the old hardcoded
  // 6 — product-owner-approved 11/12 Oct 2026) — this previously duplicated a
  // stale local 6-entry array instead of fetching the actual canonical list,
  // a real staleness gap closed here, not just a count bump.
  const { data: currencies } = useCurrencies();
  // The School's own defaultCurrency is free text (same unconfirmed-enum gap
  // this redesign fixes for MembershipPlan.currency, not yet fixed for
  // School) — only pre-fill from it when it actually matches one of the
  // confirmed codes, so a stray value there can't pre-select a currency the
  // picker doesn't offer.
  const normalizedDefaultCurrency = (currencies ?? []).some((c) => c.code === defaultCurrency?.toUpperCase())
    ? defaultCurrency!.toUpperCase()
    : undefined;
  const [form, setForm] = useState({
    type: (initial?.type as PlanType) ?? 'SUBSCRIPTION',
    title: initial?.title ?? '',
    // Hundredths, typed in normal units through MoneyField (Memberships
    // review Q1, Decision 334): "12.50" used to have to be typed as 1250.
    price: (initial?.price ?? 0) as number | null,
    priceValid: true,
    currency: initial?.currency ?? normalizedDefaultCurrency ?? '',
    expiryDurationDays: initial?.expiryDurationDays?.toString() ?? '',
    classesIncluded: initial?.classesIncluded?.toString() ?? '',
    scopedClassId: initial?.scopedClassId ?? '',
    visible: initial?.visible ?? true,
    refundFeeDate: isoToLocalInput(initial?.refundFeeDate),
    cancellationCharge: (initial?.cancellationCharge ?? null) as number | null,
    cancellationValid: true,
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    disciplineIds: initial?.disciplineIds ?? [],
    // Decision 259 — SUBSCRIPTION only.
    newMemberBillingStrategy: (initial?.newMemberBillingStrategy as 'FRESH_CYCLE' | 'PRORATED_TO_SHARED_CYCLE') ?? 'FRESH_CYCLE',
    billingCycleAnchorDay: initial?.billingCycleAnchorDay?.toString() ?? '',
    incomeCategoryId: initial?.incomeCategoryId ?? '',
    // Decision 435 items 7-9.
    startsOnFirstCheckIn: initial?.startsOnFirstCheckIn ?? false,
    fixedStartDate: initial?.fixedStartDate?.slice(0, 10) ?? '',
    fixedEndDate: initial?.fixedEndDate?.slice(0, 10) ?? '',
    switchToPlanId: initial?.switchToPlanId ?? '',
  });
  // Decision 195: "Includes lessons" follows the price (on when priced, off
  // when free) until the owner sets it.
  const [includesLessons, setIncludesLessons] = useState<boolean | null>(initial?.includesLessons ?? null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
  // prompt. No pre-selected default — the whole point of a required choice
  // is that staff make it deliberately, not fall through to whichever option
  // happened to be listed first.
  const [priceChangeStrategy, setPriceChangeStrategy] = useState<'MIGRATE' | 'GRANDFATHER' | ''>('');
  const t = useT();

  const priced = form.type !== 'FRIEND_PASS' && (form.price ?? 0) > 0;
  const lessonsOn = includesLessons ?? priced;

  // Type-conditional visibility — a client-side guardrail only. The server
  // doesn't currently reject scopedClassId/classesIncluded for a type that
  // doesn't use them either (flagged as an optional backend hardening item
  // in docs/v1.2-backend-backlog.md), so this only hides what the domain
  // rules describe as inapplicable — it doesn't change what the server will
  // accept.
  const showClassesIncluded = form.type === 'CLASS_PACK' || form.type === 'FRIEND_PASS';
  const showScopedClass = form.type === 'CLASS_PACK' || form.type === 'FRIEND_PASS';
  // SUBSCRIPTION is Stripe-cycle-driven, not expiry-driven — no stored
  // day-count applies. WEEKLY_PASS keeps showing it — Decision 249 confirms
  // Spec 55 §6.1's reading (Weekly Pass IS governed by this field) as
  // authoritative; the DTO's old "Not used by WEEKLY_PASS" description was
  // simply wrong and has been corrected to match.
  // Decision 435 items 7-9: packs, passes and trials only.
  const showTerm = TERM_TYPES.includes(form.type);
  const fixedDates = showTerm && (!!form.fixedStartDate || !!form.fixedEndDate);
  const showExpiryDuration = form.type !== 'SUBSCRIPTION' && !fixedDates;
  const priceLocked = form.type === 'FRIEND_PASS';
  const typeLocked = mode === 'edit' && activeMemberCount > 0;
  const captionKey = PLAN_TYPES.find((p) => p.value === form.type)?.caption;

  // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
  // prompt. Required exactly when MembershipsService.updatePlan() itself
  // would require it server-side (mirrored client-side so the prompt shows
  // up front rather than only after a 400): editing an existing SUBSCRIPTION
  // plan, staying SUBSCRIPTION, whose price is actually changing, AND which
  // already has at least one active Stripe-backed subscriber. A brand-new
  // plan (mode === 'create') or one with zero subscribers needs no choice —
  // same reasoning that method's own header comment documents.
  const priceChangeDecisionRequired =
    mode === 'edit' &&
    initial?.type === 'SUBSCRIPTION' &&
    form.type === 'SUBSCRIPTION' &&
    form.price !== initial?.price &&
    activeSubscriberCount > 0;

  function handleTypeChange(nextType: PlanType) {
    setForm((f) => {
      const next = { ...f, type: nextType };
      if (nextType === 'FRIEND_PASS') {
        next.price = 0;
        next.priceValid = true;
      }
      if (nextType !== 'CLASS_PACK' && nextType !== 'FRIEND_PASS') {
        next.classesIncluded = '';
        next.scopedClassId = '';
      }
      if (nextType === 'SUBSCRIPTION') next.expiryDurationDays = '';
      // Decision 259 — only SUBSCRIPTION uses this; reset to the default
      // when switching away so a stale choice doesn't linger unseen.
      if (nextType !== 'SUBSCRIPTION') {
        next.newMemberBillingStrategy = 'FRESH_CYCLE';
        next.billingCycleAnchorDay = '';
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // The previous single-view form relied on every field — including
    // Title/Price's native `required` — always being mounted, so the
    // browser's own constraint validation caught a blank one on submit.
    // With only the active step's Card mounted now, an unmounted step's
    // `required` field no longer blocks submission, so these two are
    // checked explicitly instead, jumping back to the step that needs
    // attention.
    if (!form.title.trim()) {
      setStepIndex(0);
      setError(t('membershipPlans.form.titleRequired'));
      return;
    }
    if (!form.priceValid) {
      setStepIndex(1);
      setError(t('membershipPlans.form.priceInvalid'));
      return;
    }
    if (form.price === null) {
      setStepIndex(1);
      setError(t('membershipPlans.form.priceRequired'));
      return;
    }
    // Memberships review M3/M4 (Decision 334): checked on Save from any step,
    // not only while the Pricing step is on screen. A Trial's length is the
    // School's own choice, any whole number of days from 1 (Decision 410).
    // The API refuses the same.
    const expiryDays = form.expiryDurationDays ? Number(form.expiryDurationDays) : null;
    // Decision 435 item 8: fixed dates take the place of the number of days.
    if (fixedDates && (!form.fixedStartDate || !form.fixedEndDate || form.fixedEndDate < form.fixedStartDate)) {
      setStepIndex(1);
      setError(t('membershipPlans.form.fixedDatesInvalid'));
      return;
    }
    if (!fixedDates && form.type === 'TRIAL_MEMBERSHIP' && (expiryDays === null || !Number.isInteger(expiryDays) || expiryDays < 1)) {
      setStepIndex(1);
      setError(t('membershipPlans.form.trialExpiryRequired'));
      return;
    }
    if (!fixedDates && form.type === 'WEEKLY_PASS' && (expiryDays === null || expiryDays < 1)) {
      setStepIndex(1);
      setError(t('membershipPlans.form.weeklyExpiryRequired'));
      return;
    }
    if (form.type === 'CLASS_PACK' && !form.scopedClassId && !(Number(form.classesIncluded) >= 1)) {
      setStepIndex(1);
      setError(t('membershipPlans.form.classesIncludedRequired'));
      return;
    }
    if (!form.cancellationValid) {
      setStepIndex(2);
      setError(t('membershipPlans.form.cancellationInvalid'));
      return;
    }
    // v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
    // prompt. Blocks the save client-side (same "jump back to the step that
    // needs attention" pattern as Title/Price above) rather than letting it
    // round-trip to the server's own identical 400 — the choice is required
    // before the save completes, not merely before the price takes effect.
    if (priceChangeDecisionRequired && !priceChangeStrategy) {
      setStepIndex(1);
      setError(t('membershipPlans.form.priceChangeChoiceRequired'));
      return;
    }
    // Decision 259 — same "block client-side before the identical 400"
    // pattern as the price-change prompt above.
    if (form.type === 'SUBSCRIPTION' && form.newMemberBillingStrategy === 'PRORATED_TO_SHARED_CYCLE' && !form.billingCycleAnchorDay) {
      setStepIndex(1);
      setError(t('membershipPlans.form.anchorDayRequired'));
      return;
    }
    try {
      await onSubmit({
        type: form.type,
        title: form.title.trim(),
        price: form.price,
        currency: form.currency || null,
        expiryDurationDays: showExpiryDuration && form.expiryDurationDays ? Number(form.expiryDurationDays) : null,
        // classesIncluded cannot be null on update (rejected server-side) — omit
        // rather than clear when the selected type doesn't use it.
        classesIncluded: showClassesIncluded && form.classesIncluded ? Number(form.classesIncluded) : undefined,
        // Unchanged scopes are left out: the API re-checks a scope it is sent
        // (the class must still be to come, M15), which would block editing
        // anything else on a plan for a class that has since taken place.
        scopedClassId: mode === 'edit' && (form.scopedClassId || null) === (initial?.scopedClassId ?? null) ? undefined : form.scopedClassId || null,
        // Decision 259 — SUBSCRIPTION only; omitted (not cleared) on every
        // other type, same reasoning showExpiryDuration's own comment gives
        // for expiryDurationDays above.
        newMemberBillingStrategy: form.type === 'SUBSCRIPTION' ? form.newMemberBillingStrategy : undefined,
        billingCycleAnchorDay:
          form.type === 'SUBSCRIPTION' && form.newMemberBillingStrategy === 'PRORATED_TO_SHARED_CYCLE' && form.billingCycleAnchorDay
            ? Number(form.billingCycleAnchorDay)
            : null,
        visible: form.visible,
        refundFeeDate: form.refundFeeDate ? (localInputToIso(form.refundFeeDate) ?? null) : null,
        cancellationCharge: form.cancellationCharge,
        termsWaiverRequired: form.termsWaiverRequired,
        disciplineIds: form.disciplineIds,
        includesLessons: lessonsOn,
        incomeCategoryId: form.incomeCategoryId || null,
        // Decision 435 items 7-9: only for packs, passes and trials.
        startsOnFirstCheckIn: showTerm && !fixedDates ? form.startsOnFirstCheckIn : false,
        fixedStartDate: fixedDates ? form.fixedStartDate : null,
        fixedEndDate: fixedDates ? form.fixedEndDate : null,
        switchToPlanId: showTerm ? form.switchToPlanId || null : null,
        // Omitted (undefined) whenever not required — sending it when the
        // server doesn't expect one is itself rejected (400), per
        // MembershipsService.updatePlan()'s own "a value with no effect is a
        // caller mistake worth surfacing" discipline.
        priceChangeStrategy: priceChangeDecisionRequired && priceChangeStrategy ? priceChangeStrategy : undefined,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('membershipPlans.form.backToList')}
        </Button>
      </div>
      <PageHeader title={mode === 'edit' ? t('membershipPlans.form.editTitle') : t('membershipPlans.form.addTitle')} />
      {error ? <ErrorBanner message={error} /> : null}
      {schoolCurrencyMissing ? <CurrencyFirstNotice /> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {STEPS.map((step, i) => (
          <Button
            key={step.label}
            type="button"
            variant={i === stepIndex ? 'primary' : 'secondary'}
            onClick={() => setStepIndex(i)}
          >
            {i + 1}. {t(step.label)}
          </Button>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {stepIndex === 0 ? (
        <Card className="ultm8-field-group">
          <SectionTitle>{t('membershipPlans.form.steps.basics')}</SectionTitle>
          <Field
            label={t('membershipPlans.form.typeLabel')}
            htmlFor="plan-type"
            hint={
              typeLocked
                ? t('membershipPlans.form.typeLockedHint', { count: activeMemberCount })
                : captionKey
                  ? t(captionKey)
                  : undefined
            }
          >
            <SelectField
              id="plan-type"
              disabled={typeLocked}
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value as PlanType)}
              options={PLAN_TYPES.map((p) => ({ value: p.value, label: t(p.label) }))}
            />
          </Field>
          <Field label={t('membershipPlans.form.titleLabel')} htmlFor="plan-title">
            <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
        </Card>
        ) : null}

        {stepIndex === 1 ? (
        <Card className="ultm8-field-group">
          <SectionTitle>{t('membershipPlans.form.steps.pricingAccess')}</SectionTitle>
          <Field
            label={t('membershipPlans.form.priceLabel')}
            htmlFor="plan-price"
            hint={priceLocked ? t('membershipPlans.form.priceHintLocked') : t('membershipPlans.form.priceHint')}
          >
            <MoneyField
              id="plan-price"
              disabled={priceLocked || schoolCurrencyMissing}
              value={form.price}
              currency={form.currency || normalizedDefaultCurrency || null}
              onChange={(price, priceValid) => setForm((f) => ({ ...f, price, priceValid }))}
            />
          </Field>
          {priceChangeDecisionRequired ? (
            // v1.2 backend backlog — Subscription price-change
            // migrate-vs-grandfather prompt. Shown only when it's actually
            // relevant (see priceChangeDecisionRequired's own comment above)
            // — a required choice, not a dismissible hint, so Save stays
            // blocked (handleSubmit's own check) until one is picked.
            <Field label={t('membershipPlans.form.priceChangeLabel')} htmlFor="plan-price-change-strategy">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                  {t('membershipPlans.form.priceChangeExplanation', { count: activeSubscriberCount })}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    variant={priceChangeStrategy === 'MIGRATE' ? 'primary' : 'secondary'}
                    onClick={() => setPriceChangeStrategy('MIGRATE')}
                  >
                    {t('membershipPlans.form.migrate')}
                  </Button>
                  <Button
                    type="button"
                    variant={priceChangeStrategy === 'GRANDFATHER' ? 'primary' : 'secondary'}
                    onClick={() => setPriceChangeStrategy('GRANDFATHER')}
                  >
                    {t('membershipPlans.form.grandfather')}
                  </Button>
                </div>
                <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                  {priceChangeStrategy === 'MIGRATE'
                    ? t('membershipPlans.form.migrateHint')
                    : priceChangeStrategy === 'GRANDFATHER'
                      ? t('membershipPlans.form.grandfatherHint')
                      : t('membershipPlans.form.pickOne')}
                </p>
              </div>
            </Field>
          ) : null}
          <Field label={t('membershipPlans.form.currencyLabel')} htmlFor="plan-currency" hint={t('membershipPlans.form.currencyHint')}>
            <CurrencyField
              value={form.currency}
              onChange={(code) => setForm((f) => ({ ...f, currency: code }))}
              options={[{ code: '', name: t('membershipPlans.form.notSet') }, ...(currencies ?? [])]}
              placeholder={t('membershipPlans.form.notSet')}
            />
          </Field>
          {form.type === 'SUBSCRIPTION' ? (
            // Decision 259 — a School-Owner-set-once-per-plan choice, not a
            // per-signup prompt: every new Student on this plan gets whichever
            // of the two the Owner picked here.
            <Field label={t('membershipPlans.form.newMemberBillingLabel')} htmlFor="plan-new-member-billing-strategy">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    type="button"
                    variant={form.newMemberBillingStrategy === 'FRESH_CYCLE' ? 'primary' : 'secondary'}
                    onClick={() => setForm((f) => ({ ...f, newMemberBillingStrategy: 'FRESH_CYCLE', billingCycleAnchorDay: '' }))}
                  >
                    {t('membershipPlans.form.freshCycle')}
                  </Button>
                  <Button
                    type="button"
                    variant={form.newMemberBillingStrategy === 'PRORATED_TO_SHARED_CYCLE' ? 'primary' : 'secondary'}
                    onClick={() => setForm((f) => ({ ...f, newMemberBillingStrategy: 'PRORATED_TO_SHARED_CYCLE' }))}
                  >
                    {t('membershipPlans.form.prorate')}
                  </Button>
                </div>
                <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
                  {form.newMemberBillingStrategy === 'FRESH_CYCLE'
                    ? t('membershipPlans.form.freshCycleHint')
                    : t('membershipPlans.form.prorateHint')}
                </p>
                {form.newMemberBillingStrategy === 'PRORATED_TO_SHARED_CYCLE' ? (
                  <Field label={t('membershipPlans.form.anchorDayLabel')} htmlFor="plan-billing-cycle-anchor-day" hint={t('membershipPlans.form.anchorDayHint')}>
                    <TextField
                      type="number"
                      min={1}
                      max={28}
                      required
                      value={form.billingCycleAnchorDay}
                      onChange={(e) => setForm((f) => ({ ...f, billingCycleAnchorDay: e.target.value }))}
                    />
                  </Field>
                ) : null}
              </div>
            </Field>
          ) : null}
          {showClassesIncluded ? (
            <Field
              label={t('membershipPlans.form.classesIncludedLabel')}
              htmlFor="plan-classesIncluded"
              hint={
                form.type === 'FRIEND_PASS'
                  ? t('membershipPlans.form.classesIncludedFriendHint')
                  : form.scopedClassId
                    ? t('membershipPlans.form.classesIncludedScopedHint')
                    : t('membershipPlans.form.classesIncludedHint')
              }
            >
              <TextField
                type="number"
                min={1}
                disabled={form.type === 'FRIEND_PASS' || !!form.scopedClassId}
                value={form.type === 'FRIEND_PASS' || form.scopedClassId ? '1' : form.classesIncluded}
                onChange={(e) => setForm((f) => ({ ...f, classesIncluded: e.target.value }))}
              />
            </Field>
          ) : null}
          {showScopedClass ? (
            <Field
              label={t('membershipPlans.form.scopedClassLabel')}
              htmlFor="plan-scopedClass"
              hint={t('membershipPlans.form.scopedClassHint')}
            >
              <SelectField
                value={form.scopedClassId}
                onChange={(e) => {
                  // Scoping a Class locks classesIncluded to 1 client-side too —
                  // otherwise a leftover higher value reached Save and bounced off
                  // the server's rejection instead of being prevented here.
                  const nextScopedClassId = e.target.value;
                  setForm((f) => ({ ...f, scopedClassId: nextScopedClassId, classesIncluded: nextScopedClassId ? '1' : f.classesIncluded }));
                }}
                options={[{ value: '', label: t('membershipPlans.form.notRestricted') }, ...classes.map((c) => ({ value: c.id, label: c.title }))]}
              />
            </Field>
          ) : null}
          {showExpiryDuration ? (
            <Field
              label={t('membershipPlans.form.expiryLabel')}
              htmlFor="plan-expiry"
              hint={
                form.type === 'TRIAL_MEMBERSHIP'
                  ? t('membershipPlans.form.expiryTrialHint')
                  : form.type === 'WEEKLY_PASS'
                    ? t('membershipPlans.form.expiryWeeklyHint')
                    : t('membershipPlans.form.expiryHint')
              }
            >
              <TextField
                type="number"
                min={1}
                value={form.expiryDurationDays}
                onChange={(e) => setForm((f) => ({ ...f, expiryDurationDays: e.target.value }))}
              />
            </Field>
          ) : null}
          {/* Decision 435 item 7: the days start on the first check-in. */}
          {showTerm && !fixedDates ? (
            <>
              <Checkbox
                id="plan-first-check-in"
                label={t('membershipPlans.form.startsOnFirstCheckIn')}
                checked={form.startsOnFirstCheckIn}
                onChange={(e) => setForm((f) => ({ ...f, startsOnFirstCheckIn: e.target.checked }))}
              />
              <p className="ultm8-field__hint" style={{ margin: '4px 0 12px' }}>
                {t('membershipPlans.form.startsOnFirstCheckInHint')}
              </p>
            </>
          ) : null}
          {/* Decision 435 item 8: a plan on fixed dates, like a 6-week camp. */}
          {showTerm && !form.startsOnFirstCheckIn ? (
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }} data-testid="plan-fixed-dates">
              <legend className="ultm8-field__label">{t('membershipPlans.form.fixedDatesLegend')}</legend>
              <p className="ultm8-field__hint" style={{ marginTop: 0 }}>{t('membershipPlans.form.fixedDatesHint')}</p>
              <Field label={t('membershipPlans.form.fixedStartLabel')} htmlFor="plan-fixed-start">
                <TextField id="plan-fixed-start" type="date" value={form.fixedStartDate} onChange={(e) => setForm((f) => ({ ...f, fixedStartDate: e.target.value }))} />
              </Field>
              <Field label={t('membershipPlans.form.fixedEndLabel')} htmlFor="plan-fixed-end">
                <TextField id="plan-fixed-end" type="date" value={form.fixedEndDate} onChange={(e) => setForm((f) => ({ ...f, fixedEndDate: e.target.value }))} />
              </Field>
            </fieldset>
          ) : null}
        </Card>
        ) : null}

        {stepIndex === 2 ? (
        <Card className="ultm8-field-group">
          <SectionTitle>{t('membershipPlans.form.steps.policies')}</SectionTitle>
          <Field
            label={t('membershipPlans.form.refundLabel')}
            htmlFor="plan-refundFeeDate"
            hint={t('membershipPlans.form.leaveBlankToClear')}
          >
            <TextField
              type="datetime-local"
              value={form.refundFeeDate}
              onChange={(e) => setForm((f) => ({ ...f, refundFeeDate: e.target.value }))}
            />
          </Field>
          <Field
            label={t('membershipPlans.form.cancellationLabel')}
            htmlFor="plan-cancellationCharge"
            hint={t('membershipPlans.form.cancellationHint')}
          >
            <MoneyField
              id="plan-cancellationCharge"
              disabled={schoolCurrencyMissing}
              value={form.cancellationCharge}
              currency={form.currency || normalizedDefaultCurrency || null}
              onChange={(cancellationCharge, cancellationValid) => setForm((f) => ({ ...f, cancellationCharge, cancellationValid }))}
            />
          </Field>
          <Checkbox
            label={t('membershipPlans.form.waiverRequired')}
            checked={form.termsWaiverRequired}
            onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
          />
          {/* Decision 435 item 9: switch to another plan when it ends. */}
          {showTerm ? (
            <Field label={t('membershipPlans.form.switchToLabel')} htmlFor="plan-switch-to" hint={t('membershipPlans.form.switchToHint')}>
              <SelectField
                id="plan-switch-to"
                value={form.switchToPlanId}
                onChange={(e) => setForm((f) => ({ ...f, switchToPlanId: e.target.value }))}
                options={[
                  { value: '', label: t('membershipPlans.form.switchToNone') },
                  ...switchTargets.map((p) => ({ value: p.id, label: p.title })),
                  // A next plan that no longer qualifies stays shown, so saving doesn't silently drop it.
                  ...(form.switchToPlanId && !switchTargets.some((p) => p.id === form.switchToPlanId) ? [{ value: form.switchToPlanId, label: form.switchToPlanId }] : []),
                ]}
              />
            </Field>
          ) : null}
          {/* Decision 316 item 10: shown in the Transactions export. */}

          <Field label={t('charges.incomeCategories.fieldLabel')} htmlFor="plan-incomeCategory" hint={t('charges.incomeCategories.fieldHint')}>
            <SelectField
              id="plan-incomeCategory"
              value={form.incomeCategoryId}
              onChange={(e) => setForm((f) => ({ ...f, incomeCategoryId: e.target.value }))}
              options={incomeCategoryOptions(incomeCategories, t('charges.incomeCategories.none'))}
            />
          </Field>
        </Card>
        ) : null}

        {stepIndex === 3 ? (
        <Card className="ultm8-field-group">
          <SectionTitle>{t('membershipPlans.form.steps.disciplinesLessons')}</SectionTitle>
          {disciplines.length > 0 ? (
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="ultm8-field__label">{t('membershipPlans.form.stylesLegend')}</legend>
              {disciplines
                .filter((d) => !d.archivedAt || (initial?.disciplineIds ?? []).includes(d.id))
                .map((d) => (
                <Checkbox
                  key={d.id}
                  label={d.archivedAt ? t('disciplines.stylePicker.archivedName', { name: d.name }) : d.name}
                  checked={form.disciplineIds.includes(d.id)}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      disciplineIds: e.target.checked ? [...f.disciplineIds, d.id] : f.disciplineIds.filter((x) => x !== d.id),
                    }))
                  }
                />
              ))}
            </fieldset>
          ) : null}
          <Checkbox label={t('membershipPlans.form.includesLessons')} checked={lessonsOn} onChange={(e) => setIncludesLessons(e.target.checked)} />
          <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
            {t('membershipPlans.form.includesLessonsHint')}
          </p>
        </Card>
        ) : null}

        {stepIndex === 4 ? (
        <Card className="ultm8-field-group">
          <SectionTitle>{t('membershipPlans.form.steps.visibility')}</SectionTitle>
          <Checkbox
            label={t('membershipPlans.form.visibleToStudents')}
            checked={form.visible}
            onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
          />
        </Card>
        ) : null}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {stepIndex > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setStepIndex((i) => i - 1)}>
                {t('membershipPlans.form.back')}
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
          {stepIndex < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStepIndex((i) => i + 1)}>
              {t('membershipPlans.form.next')}
            </Button>
          ) : (
            <Button type="submit" loading={submitting}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
