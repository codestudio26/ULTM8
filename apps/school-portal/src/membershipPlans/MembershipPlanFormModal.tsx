import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { ClassResponse } from '../classes/classQueries';
import { isoToLocalInput, localInputToIso } from '../lib/datetime';
import type { MembershipPlanResponse } from './membershipPlanQueries';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';

const PLAN_TYPES = ['SUBSCRIPTION', 'CLASS_PACK', 'WEEKLY_PASS', 'FRIEND_PASS', 'TRIAL_MEMBERSHIP'] as const;

export interface MembershipPlanFormValues {
  type: (typeof PLAN_TYPES)[number];
  title: string;
  price: number;
  /** `null` means "cleared" — UpdateMembershipPlanDto accepts `null` on these
   * fields to mean exactly that (see that DTO's own header comment); the
   * page-level caller maps `null` back to `undefined` for the CREATE path,
   * which has nothing to clear. */
  currency?: string | null;
  expiryDurationDays?: number | null;
  classesIncluded?: number;
  scopedClassId?: string | null;
  /** Always populated — the checkboxes default to true/false, never undefined. */
  visible: boolean;
  /** Not clearable via this form yet — MembershipsService.updatePlan()
   * converts this via `dto.refundFeeDate ? new Date(dto.refundFeeDate) :
   * undefined`, a falsy check that would treat an explicit `null` the same
   * as an omitted field. A real, separate, flagged backend gap (see that
   * DTO's own comment), not something this form can fix on its own. */
  refundFeeDate?: string;
  cancellationCharge?: number | null;
  termsWaiverRequired: boolean;
  /** The styles this plan covers, and whether it includes their lessons (Decision 195). */
  disciplineIds: string[];
  includesLessons: boolean;
}

/** Fields match CreateMembershipPlanDto/UpdateMembershipPlanDto exactly —
 * apps/api/src/memberships/dto/create-membership-plan.dto.ts. Cross-field
 * rules (FRIEND_PASS forces price=0/classesIncluded=1, scopedClassId caps
 * classesIncluded at 1, SUBSCRIPTION needs a Stripe PaymentAccount) are
 * enforced server-side in MembershipsService — this form doesn't duplicate
 * that logic client-side, same as ClassFormModal doesn't duplicate
 * ClassesService's own cross-field checks; a rejected combination surfaces
 * as a plain ApiError from the save attempt. */
export function MembershipPlanFormModal({
  title,
  initial,
  classes,
  disciplines,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<MembershipPlanResponse>;
  classes: ClassResponse[];
  disciplines: DisciplineResponse[];
  submitting: boolean;
  onSubmit: (values: MembershipPlanFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    type: (initial?.type as (typeof PLAN_TYPES)[number]) ?? 'SUBSCRIPTION',
    title: initial?.title ?? '',
    price: initial?.price?.toString() ?? '0',
    currency: initial?.currency ?? '',
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
  const priced = form.type !== 'FRIEND_PASS' && Number(form.price) > 0;
  const lessonsOn = includesLessons ?? priced;
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        type: form.type,
        title: form.title,
        price: Number(form.price),
        currency: form.currency || null,
        expiryDurationDays: form.expiryDurationDays ? Number(form.expiryDurationDays) : null,
        classesIncluded: form.classesIncluded ? Number(form.classesIncluded) : undefined,
        scopedClassId: form.scopedClassId || null,
        visible: form.visible,
        refundFeeDate: localInputToIso(form.refundFeeDate),
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
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Type" htmlFor="plan-type">
          <SelectField
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as (typeof PLAN_TYPES)[number] }))}
            options={[
              { value: 'SUBSCRIPTION', label: 'Subscription' },
              { value: 'CLASS_PACK', label: 'Class Pack' },
              { value: 'WEEKLY_PASS', label: 'Weekly Pass' },
              { value: 'FRIEND_PASS', label: 'Friend Pass' },
              { value: 'TRIAL_MEMBERSHIP', label: 'Trial Membership' },
            ]}
          />
        </Field>
        <Field label="Title" htmlFor="plan-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field
          label="Price"
          htmlFor="plan-price"
          hint={form.type === 'FRIEND_PASS' ? "Minor currency unit — forced to 0 for Friend Pass." : 'Minor currency unit (e.g. cents).'}
        >
          <TextField
            type="number"
            min={0}
            required
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </Field>
        <Field label="Currency" htmlFor="plan-currency" hint="Your School's own choice — no conversion applied.">
          <TextField value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))} />
        </Field>
        <Field
          label="Expiry duration (days)"
          htmlFor="plan-expiry"
          hint="Computes each purchased Membership's expiry date at purchase time. Not used by Weekly Pass."
        >
          <TextField
            type="number"
            min={1}
            value={form.expiryDurationDays}
            onChange={(e) => setForm((f) => ({ ...f, expiryDurationDays: e.target.value }))}
          />
        </Field>
        <Field
          label="Classes included"
          htmlFor="plan-classesIncluded"
          hint={
            form.type === 'FRIEND_PASS'
              ? 'Forced to 1 for Friend Pass.'
              : form.scopedClassId
                ? 'Capped at 1 while scoped to a specific Class.'
                : 'Class Pack / Friend Pass credit quantity.'
          }
        >
          <TextField
            type="number"
            min={1}
            value={form.classesIncluded}
            onChange={(e) => setForm((f) => ({ ...f, classesIncluded: e.target.value }))}
          />
        </Field>
        <Field label="Scoped to Class" htmlFor="plan-scopedClass" hint="Restricts this plan to one specific Class.">
          <SelectField
            value={form.scopedClassId}
            onChange={(e) => setForm((f) => ({ ...f, scopedClassId: e.target.value }))}
            options={[{ value: '', label: 'Not restricted' }, ...classes.map((c) => ({ value: c.id, label: c.title }))]}
          />
        </Field>
        <Field
          label="Refund/credit cutoff"
          htmlFor="plan-refundFeeDate"
          hint={initial?.refundFeeDate ? "Can't be cleared from this form yet — set a new date instead." : undefined}
        >
          <TextField
            type="datetime-local"
            value={form.refundFeeDate}
            onChange={(e) => setForm((f) => ({ ...f, refundFeeDate: e.target.value }))}
          />
        </Field>
        <Field label="Cancellation charge" htmlFor="plan-cancellationCharge" hint="Minor currency unit (e.g. cents).">
          <TextField
            type="number"
            min={0}
            value={form.cancellationCharge}
            onChange={(e) => setForm((f) => ({ ...f, cancellationCharge: e.target.value }))}
          />
        </Field>
        <Checkbox
          label="Visible to Students"
          checked={form.visible}
          onChange={(e) => setForm((f) => ({ ...f, visible: e.target.checked }))}
        />
        <Checkbox
          label="Requires signed waiver/terms to purchase"
          checked={form.termsWaiverRequired}
          onChange={(e) => setForm((f) => ({ ...f, termsWaiverRequired: e.target.checked }))}
        />
        {disciplines.length > 0 ? (
          <fieldset style={{ border: 'none', padding: 0, margin: '12px 0 0' }}>
            <legend className="ultm8-field__label">Styles this plan covers</legend>
            {disciplines.map((d) => (
              <Checkbox
                key={d.id}
                label={d.name}
                checked={form.disciplineIds.includes(d.id)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, disciplineIds: e.target.checked ? [...f.disciplineIds, d.id] : f.disciplineIds.filter((x) => x !== d.id) }))
                }
              />
            ))}
          </fieldset>
        ) : null}
        <Checkbox label="Includes lessons" checked={lessonsOn} onChange={(e) => setIncludesLessons(e.target.checked)} />
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          Members on this plan can watch the lessons of its styles. On by default when the plan has a price, off when it's free.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
