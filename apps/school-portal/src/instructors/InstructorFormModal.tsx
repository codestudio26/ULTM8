import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import type { EligibleInstructorUser, InstructorResponse } from './instructorQueries';

/** Fields match CreateInstructorDto/UpdateInstructorDto exactly —
 * apps/api/src/instructors/dto/create-instructor.dto.ts. `userId` is a
 * dropdown of Users already holding an active INSTRUCTOR RoleGrant at this
 * School (GET .../instructors/eligible-users, Decision 111) — that role must
 * be granted first via the Staff page; this picker only shows who already
 * qualifies. `userId` is only editable on create — CreateInstructorDto has
 * it, UpdateInstructorDto (PartialType, per this codebase's DTO convention)
 * would technically accept it too, but re-pointing an existing profile at a
 * different User isn't a real product action, so it's fixed after creation. */
export function InstructorFormModal({
  title,
  initial,
  branches,
  eligibleUsers,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<InstructorResponse>;
  branches: BranchResponse[];
  /** Only needed (and only rendered) on create — see the `isEdit` check below. */
  eligibleUsers?: EligibleInstructorUser[];
  submitting: boolean;
  onSubmit: (values: {
    /** Always populated (required on create; echoed from `initial` on edit) —
     * the caller decides whether to forward it, since UpdateInstructorDto
     * doesn't accept it at all (see this file's own header comment). */
    userId: string;
    /** `null` means "cleared" — UpdateInstructorDto accepts `null` on these
     * fields to mean exactly that (see that DTO's own header comment); the
     * page-level caller maps `null` back to `undefined` for the CREATE path,
     * which has nothing to clear. */
    branchId?: string | null;
    photoUrl?: string | null;
    beltRanking?: string | null;
    specializations?: string[];
    phone?: string | null;
    yearsOfExperience?: number | null;
    bio?: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    userId: initial?.userId ?? '',
    branchId: initial?.branchId ?? '',
    photoUrl: initial?.photoUrl ?? '',
    beltRanking: initial?.beltRanking ?? '',
    specializations: (initial?.specializations ?? []).join(', '),
    phone: initial?.phone ?? '',
    yearsOfExperience: initial?.yearsOfExperience?.toString() ?? '',
    bio: initial?.bio ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        userId: form.userId,
        branchId: form.branchId || null,
        photoUrl: form.photoUrl || null,
        beltRanking: form.beltRanking || null,
        specializations: form.specializations
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        phone: form.phone || null,
        yearsOfExperience: form.yearsOfExperience ? Number(form.yearsOfExperience) : null,
        bio: form.bio || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {isEdit ? null : (
          <Field
            label="User"
            htmlFor="instructor-userId"
            hint="Must already hold an active Instructor role at this School — grant it first on the Staff page."
          >
            <SelectField
              required
              value={form.userId}
              onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
              options={[
                { value: '', label: 'Select a user…' },
                ...(eligibleUsers ?? []).map((u) => ({
                  value: u.id,
                  label: `${u.firstName} ${u.surname} (${u.email})`,
                })),
              ]}
            />
          </Field>
        )}
        <Field label="Branch" htmlFor="instructor-branch" hint="Leave unselected for a School-wide profile.">
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: 'Whole School' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
        <Field label="Photo URL" htmlFor="instructor-photo">
          <TextField value={form.photoUrl} onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))} />
        </Field>
        <Field label="Belt / ranking" htmlFor="instructor-belt" hint='Display text, e.g. "Black Belt, 3rd Dan".'>
          <TextField value={form.beltRanking} onChange={(e) => setForm((f) => ({ ...f, beltRanking: e.target.value }))} />
        </Field>
        <Field label="Specializations" htmlFor="instructor-specializations" hint="Comma-separated">
          <TextField
            value={form.specializations}
            onChange={(e) => setForm((f) => ({ ...f, specializations: e.target.value }))}
          />
        </Field>
        <Field label="Phone" htmlFor="instructor-phone" hint="E.164 format, e.g. +14155551234">
          <TextField value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </Field>
        <Field label="Years of experience" htmlFor="instructor-experience">
          <TextField
            type="number"
            min={0}
            value={form.yearsOfExperience}
            onChange={(e) => setForm((f) => ({ ...f, yearsOfExperience: e.target.value }))}
          />
        </Field>
        <Field label="Bio" htmlFor="instructor-bio">
          <TextArea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
        </Field>
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
