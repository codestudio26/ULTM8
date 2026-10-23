import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, PhoneField, PhotoUploadField, SelectField, TextArea, TextField } from '@ultm8/ui';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import { ApiError } from '@ultm8/api-client';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useRequestPublicPhotoUploadUrl } from '../uploads/uploadQueries';
import type { EligibleInstructorUser, InstructorResponse } from './instructorQueries';
import { useT } from '../i18n/I18nProvider';

/** Fields match CreateInstructorDto/UpdateInstructorDto exactly —
 * apps/api/src/instructors/dto/create-instructor.dto.ts. `userId` is a
 * dropdown of Users already holding an active INSTRUCTOR RoleGrant at this
 * School (GET .../instructors/eligible-users, Decision 115) — that role must
 * be granted first via the Staff page; this picker only shows who already
 * qualifies. `userId` is only editable on create — CreateInstructorDto has
 * it, UpdateInstructorDto (PartialType, per this codebase's DTO convention)
 * would technically accept it too, but re-pointing an existing profile at a
 * different User isn't a real product action, so it's fixed after creation. */
export function InstructorFormModal({
  title,
  schoolId,
  initial,
  branches,
  disciplines,
  eligibleUsers,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  /** Required so the Photo field's upload URL request can be authorized
   * (School Owner at this School — see UploadsService's own comment) and
   * correctly key-prefixed, on both create (no Instructor id yet) and edit. */
  schoolId: string;
  initial?: Partial<InstructorResponse>;
  branches: BranchResponse[];
  /** The School's styles. With any, specialisations are picked from them
   * instead of free text (Decision 152). */
  disciplines: DisciplineResponse[];
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
    specializations?: string[];
    specializationStyleIds?: string[];
    phone?: string | null;
    yearsOfExperience?: number | null;
    bio?: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({
    userId: initial?.userId ?? '',
    branchId: initial?.branchId ?? '',
    photoUrl: initial?.photoUrl ?? '',
    specializations: (initial?.specializations ?? []).join(', '),
    phone: initial?.phone ?? '',
    yearsOfExperience: initial?.yearsOfExperience?.toString() ?? '',
    bio: initial?.bio ?? '',
  });
  const [styleIds, setStyleIds] = useState<string[]>(initial?.specializationStyleIds ?? []);
  const usesStyles = disciplines.length > 0;
  const [error, setError] = useState<string | null>(null);
  const requestPhotoUpload = useRequestPublicPhotoUploadUrl();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        userId: form.userId,
        branchId: form.branchId || null,
        photoUrl: form.photoUrl || null,
        ...(usesStyles
          ? { specializationStyleIds: styleIds }
          : {
              specializations: form.specializations
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }),
        phone: form.phone || null,
        yearsOfExperience: form.yearsOfExperience ? Number(form.yearsOfExperience) : null,
        bio: form.bio || null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {isEdit ? null : (
          <Field
            label={t('instructors.form.user')}
            htmlFor="instructor-userId"
            hint={t('instructors.form.userHint')}
          >
            <SelectField
              required
              value={form.userId}
              onChange={(e) => {
                const userId = e.target.value;
                // Start on the branch their Instructor role is for: a whole-School
                // profile needs a whole-School role (Decision 311, I13).
                const picked = (eligibleUsers ?? []).find((u) => u.id === userId);
                const roleBranch = picked && !picked.schoolWide ? picked.branchIds.find((id) => branches.some((b) => b.id === id && !b.archivedAt)) : undefined;
                setForm((f) => ({ ...f, userId, branchId: roleBranch ?? (picked?.schoolWide ? f.branchId : '') }));
              }}
              options={[
                { value: '', label: t('instructors.form.userPlaceholder') },
                ...(eligibleUsers ?? []).map((u) => ({
                  value: u.id,
                  label: `${u.firstName} ${u.surname} (${u.email})`,
                })),
              ]}
            />
          </Field>
        )}
        <Field label={t('instructors.form.branch')} htmlFor="instructor-branch" hint={t('instructors.form.branchHint')}>
          <SelectField
            value={form.branchId}
            onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
            options={[{ value: '', label: t('instructors.form.wholeSchool') }, ...branchSelectOptions(branches, t('branches.archivedBadge'), initial?.branchId)]}
          />
        </Field>
        <Field label={t('instructors.form.photo')} htmlFor="instructor-photo">
          <PhotoUploadField
            value={form.photoUrl}
            onChange={(photoUrl) => setForm((f) => ({ ...f, photoUrl }))}
            requestUpload={(file) =>
              requestPhotoUpload.mutateAsync({
                entityType: 'INSTRUCTOR',
                schoolId,
                entityId: initial?.id,
                contentType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
              })
            }
          />
        </Field>
        {usesStyles ? (
          <Field label={t('instructors.form.specializations')} htmlFor="instructor-specializations" hint={t('instructors.form.specializationsStylesHint')}>
            <div id="instructor-specializations">
              {disciplines.map((d) => (
                <Checkbox
                  key={d.id}
                  label={d.name}
                  checked={styleIds.includes(d.id)}
                  onChange={(e) => setStyleIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id)))}
                />
              ))}
            </div>
          </Field>
        ) : (
          <Field label={t('instructors.form.specializations')} htmlFor="instructor-specializations" hint={t('instructors.form.specializationsHint')}>
            <TextField
              value={form.specializations}
              onChange={(e) => setForm((f) => ({ ...f, specializations: e.target.value }))}
            />
          </Field>
        )}
        <Field label={t('instructors.form.phone')} htmlFor="instructor-phone">
          <PhoneField
            value={form.phone}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            defaultCountry={guessDefaultCountry()}
          />
        </Field>
        <Field label={t('instructors.form.yearsOfExperience')} htmlFor="instructor-experience">
          <TextField
            type="number"
            min={0}
            value={form.yearsOfExperience}
            onChange={(e) => setForm((f) => ({ ...f, yearsOfExperience: e.target.value }))}
          />
        </Field>
        <Field label={t('instructors.form.bio')} htmlFor="instructor-bio">
          <TextArea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
