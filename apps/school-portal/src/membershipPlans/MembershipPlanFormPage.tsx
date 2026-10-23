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
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import {
  useCreateMembershipPlan,
  useMembershipPlan,
  useMembershipPlanActiveCount,
  useUpdateMembershipPlan,
  type MembershipPlanResponse,
} from './membershipPlanQueries';

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
  const createPlan = useCreateMembershipPlan(schoolId ?? '');
  const updatePlan = useUpdateMembershipPlan(schoolId ?? '', id ?? '');
  const t = useT();

  if (!schoolId) return null;
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
    <MembershipPlanForm
      mode={isEdit ? 'edit' : 'create'}
      initial={initial}
      classes={classData?.items ?? []}
      disciplines={disciplineData?.items ?? []}
      defaultCurrency={school?.defaultCurrency ?? undefined}
      activeSubscriberCount={activeCountData?.activeCount ?? 0}
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
  defaultCurrency,
  activeSubscriberCount,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<MembershipPlanResponse>;
  classes: ClassResponse[];
  disciplines: DisciplineResponse[];
  defaultCurrency?: string;
  /** v1.2 backend backlog — how many ACTIVE, Stripe-backed subscribers this
   * plan currently has. Always 0 on Create (nothing to migrate/grandfather
   * for a plan that doesn't exist yet). */
  activeSubscriberCount: number;
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
    price: initial?.price?.toString() ?? '0',
    currency: initial?.currency ?? normalizedDefaultCurrency ?? '',
    expiryDurationDays: initial?.expiryDurationDays?.toString() ?? '',
    classesIncluded: initial?.classesIncluded?.toString() ?? '',
    scopedClassId: initial?.scopedClassId ?? '',
    visible: initial?.visible ?? true,
    refundFeeDate: isoToLocalInput(initial?.refundFeeDate),
    cancellationCharge: initial?.cancellationCharge?.toString() ?? '',
    termsWaiverRequired: initial?.termsWaiverRequired ?? false,
    disciplineIds: initial?.disciplineIds ?? [],
    // Decision 259 — SUBSCRIPTION only.
    newMemberBillingStrategy: (initial?.newMemberBillingStrategy as 'FRESH_CYCLE' | 'PRORATED_TO_SHARED_CYCLE') ?? 'FRESH_CYCLE',
    billingCycleAnchorDay: initial?.billingCycleAnchorDay?.toString() ?? '',
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

  const priced = form.type !== 'FRIEND_PASS' && Number(form.price) > 0;
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
  const showExpiryDuration = form.type !== 'SUBSCRIPTION';
  const priceLocked = form.type === 'FRIEND_PASS';
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
    Number(form.price) !== initial?.price &&
    activeSubscriberCount > 0;

  function handleTypeChange(nextType: PlanType) {
    setForm((f) => {
      const next = { ...f, type: nextType };
      if (nextType === 'FRIEND_PASS') next.price = '0';
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
    if (!form.price.trim()) {
      setStepIndex(1);
      setError(t('membershipPlans.form.priceRequired'));
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
        title: form.title,
        price: Number(form.price),
        currency: form.currency || null,
        expiryDurationDays: showExpiryDuration && form.expiryDurationDays ? Number(form.expiryDurationDays) : null,
        // classesIncluded cannot be null on update (rejected server-side) — omit
        // rather than clear when the selected type doesn't use it.
        classesIncluded: showClassesIncluded && form.classesIncluded ? Number(form.classesIncluded) : undefined,
        scopedClassId: form.scopedClassId || null,
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
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
        termsWaiverRequired: form.termsWaiverRequired,
        disciplineIds: form.disciplineIds,
        includesLessons: lessonsOn,
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
          <Field label={t('membershipPlans.form.typeLabel')} htmlFor="plan-type" hint={captionKey ? t(captionKey) : undefined}>
            <SelectField
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
            <TextField
              type="number"
              min={0}
              required
              disabled={priceLocked}
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
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
                  : t('membershipPlans.form.expiryHint')
              }
            >
              <TextField
                type="number"
                min={1}
                max={form.type === 'TRIAL_MEMBERSHIP' ? 30 : undefined}
                value={form.expiryDurationDays}
                onChange={(e) => setForm((f) => ({ ...f, expiryDurationDays: e.target.value }))}
              />
            </Field>
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
            <TextField
              type="number"
              min={0}
              value={form.cancellationCharge}
              onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
            />
          </Field>
          <Checkbox
            label={t('membershipPlans.form.waiverRequired')}
            checked={form.termsWaiverRequired}
            onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
          />
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
