import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Checkbox, ErrorBanner, Field, PageHeader, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { nullsToUndefined } from '../lib/nullableFields';
import { isoToLocalInput, localInputToIso } from '../lib/datetime';
import {
  useCreateMembershipPlan,
  useMembershipPlan,
  useUpdateMembershipPlan,
  type MembershipPlanResponse,
} from './membershipPlanQueries';

const PLAN_TYPES = [
  { value: 'SUBSCRIPTION', label: 'Subscription', caption: 'Recurring billing, ongoing access.' },
  { value: 'CLASS_PACK', label: 'Class Pack', caption: 'A fixed number of class credits — general, or scoped to one Class.' },
  { value: 'WEEKLY_PASS', label: 'Weekly Pass', caption: 'Unlimited access for a fixed window, no recurring charge.' },
  { value: 'FRIEND_PASS', label: 'Friend Pass', caption: 'A free guest pass the School gifts — always £0.' },
  { value: 'TRIAL_MEMBERSHIP', label: 'Trial Membership', caption: 'A free, time-limited trial — capped at 30 days total per Student.' },
] as const;

type PlanType = (typeof PLAN_TYPES)[number]['value'];

// The platform's 6 supported currencies, confirmed directly against Spec 55
// §11.2 ("6 currencies observed: GBP, EUR, USD, BRL, AED, MYR") — not
// previously listed in skills/ultm8-domain-rules/SKILL.md, verified against
// the spec document itself. Replaces the old free-text currency field.
const CURRENCIES = [
  { value: '', label: 'Not set' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'BRL', label: 'BRL — Brazilian Real' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'MYR', label: 'MYR — Malaysian Ringgit' },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
      {children}
    </h2>
  );
}

export function MembershipPlanFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const schoolId = useOwnedSchoolId();
  const { data: school } = useSchool(schoolId);
  const { data: classData } = useClasses(schoolId);
  const { data: disciplineData } = useDisciplines(schoolId);
  const { data: existingPlan, isLoading: planLoading, error: planError } = useMembershipPlan(id ?? null);
  const createPlan = useCreateMembershipPlan(schoolId ?? '');
  const updatePlan = useUpdateMembershipPlan(schoolId ?? '', id ?? '');

  if (!schoolId) return null;
  if (isEdit && planLoading) return <Spinner />;
  if (isEdit && planError) {
    return <ErrorBanner message={planError instanceof ApiError ? planError.message : 'Could not load this Membership Plan.'} />;
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
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit';
  initial?: Partial<MembershipPlanResponse>;
  classes: ClassResponse[];
  disciplines: DisciplineResponse[];
  defaultCurrency?: string;
  submitting: boolean;
  onSubmit: (values: MembershipPlanFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  // The School's own defaultCurrency is free text (same unconfirmed-enum gap
  // this redesign fixes for MembershipPlan.currency, not yet fixed for
  // School) — only pre-fill from it when it actually matches one of the 6
  // confirmed codes, so a stray value there can't pre-select a currency the
  // dropdown doesn't offer.
  const normalizedDefaultCurrency = CURRENCIES.some((c) => c.value === defaultCurrency?.toUpperCase())
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
  });
  // Decision 195: "Includes lessons" follows the price (on when priced, off
  // when free) until the owner sets it.
  const [includesLessons, setIncludesLessons] = useState<boolean | null>(initial?.includesLessons ?? null);
  const [error, setError] = useState<string | null>(null);

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
  // day-count applies. WEEKLY_PASS is left showing it: Spec 55 §6.1 describes
  // Weekly Pass as "governed by an expiry date," while this same DTO's own
  // field description says "Not used by WEEKLY_PASS" — a genuine, unresolved
  // contradiction between two primary sources (flagged in the backend notes,
  // not guessed at here; showing the field is the safer default of the two,
  // since hiding it would block setting a value that may turn out to matter).
  const showExpiryDuration = form.type !== 'SUBSCRIPTION';
  const priceLocked = form.type === 'FRIEND_PASS';

  function handleTypeChange(nextType: PlanType) {
    setForm((f) => {
      const next = { ...f, type: nextType };
      if (nextType === 'FRIEND_PASS') next.price = '0';
      if (nextType !== 'CLASS_PACK' && nextType !== 'FRIEND_PASS') {
        next.classesIncluded = '';
        next.scopedClassId = '';
      }
      if (nextType === 'SUBSCRIPTION') next.expiryDurationDays = '';
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
        visible: form.visible,
        refundFeeDate: form.refundFeeDate ? (localInputToIso(form.refundFeeDate) ?? null) : null,
        cancellationCharge: form.cancellationCharge ? Number(form.cancellationCharge) : null,
        termsWaiverRequired: form.termsWaiverRequired,
        disciplineIds: form.disciplineIds,
        includesLessons: lessonsOn,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          ← Back to Membership Plans
        </Button>
      </div>
      <PageHeader title={mode === 'edit' ? 'Edit membership plan' : 'Add membership plan'} />
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card className="ultm8-field-group">
          <SectionTitle>Basics</SectionTitle>
          <Field label="Type" htmlFor="plan-type" hint={PLAN_TYPES.find((t) => t.value === form.type)?.caption}>
            <SelectField
              value={form.type}
              onChange={(e) => handleTypeChange(e.target.value as PlanType)}
              options={PLAN_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            />
          </Field>
          <Field label="Title" htmlFor="plan-title">
            <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
        </Card>

        <Card className="ultm8-field-group">
          <SectionTitle>Pricing &amp; Access</SectionTitle>
          <Field
            label="Price"
            htmlFor="plan-price"
            hint={priceLocked ? 'Minor currency unit — forced to 0 for Friend Pass.' : 'Minor currency unit (e.g. cents).'}
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
          <Field label="Currency" htmlFor="plan-currency" hint="Your School's own choice — no conversion applied.">
            <SelectField
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              options={CURRENCIES}
            />
          </Field>
          {showClassesIncluded ? (
            <Field
              label="Classes included"
              htmlFor="plan-classesIncluded"
              hint={
                form.type === 'FRIEND_PASS'
                  ? 'Forced to 1 for Friend Pass.'
                  : form.scopedClassId
                    ? 'Capped at 1 while scoped to a specific Class.'
                    : 'Class Pack credit quantity.'
              }
            >
              <TextField
                type="number"
                min={1}
                disabled={form.type === 'FRIEND_PASS'}
                value={form.type === 'FRIEND_PASS' ? '1' : form.classesIncluded}
                onChange={(e) => setForm((f) => ({ ...f, classesIncluded: e.target.value }))}
              />
            </Field>
          ) : null}
          {showScopedClass ? (
            <Field label="Scoped to Class" htmlFor="plan-scopedClass" hint="Restricts this plan to one specific Class — leave as Not restricted to clear.">
              <SelectField
                value={form.scopedClassId}
                onChange={(e) => setForm((f) => ({ ...f, scopedClassId: e.target.value }))}
                options={[{ value: '', label: 'Not restricted' }, ...classes.map((c) => ({ value: c.id, label: c.title }))]}
              />
            </Field>
          ) : null}
          {showExpiryDuration ? (
            <Field
              label="Expiry duration (days)"
              htmlFor="plan-expiry"
              hint={
                form.type === 'TRIAL_MEMBERSHIP'
                  ? "Capped at 30 days per Trial, and cumulatively over a rolling 12 months for the same Student at this School."
                  : "Computes each purchased Membership's expiry date at purchase time. Leave blank to clear."
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

        <Card className="ultm8-field-group">
          <SectionTitle>Policies</SectionTitle>
          <Field label="Refund/credit cutoff" htmlFor="plan-refundFeeDate" hint="Leave blank to clear.">
            <TextField
              type="datetime-local"
              value={form.refundFeeDate}
              onChange={(e) => setForm((f) => ({ ...f, refundFeeDate: e.target.value }))}
            />
          </Field>
          <Field
            label="Cancellation charge"
            htmlFor="plan-cancellationCharge"
            hint="Minor currency unit (e.g. cents). Stored for a future charging flow — not yet automatically collected. Leave blank to clear."
          >
            <TextField
              type="number"
              min={0}
              value={form.cancellationCharge}
              onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
            />
          </Field>
          <Checkbox
            label="Requires signed waiver/terms to purchase"
            checked={form.termsWaiverRequired}
            onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
          />
        </Card>

        <Card className="ultm8-field-group">
          <SectionTitle>Disciplines &amp; Lessons</SectionTitle>
          {disciplines.length > 0 ? (
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="ultm8-field__label">Styles this plan covers</legend>
              {disciplines.map((d) => (
                <Checkbox
                  key={d.id}
                  label={d.name}
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
          <Checkbox label="Includes lessons" checked={lessonsOn} onChange={(e) => setIncludesLessons(e.target.checked)} />
          <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
            Members on this plan can watch the lessons of its styles. On by default when the plan has a price, off when it's free.
          </p>
        </Card>

        <Card className="ultm8-field-group">
          <SectionTitle>Visibility</SectionTitle>
          <Checkbox
            label="Visible to Students"
            checked={form.visible}
            onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
          />
        </Card>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
