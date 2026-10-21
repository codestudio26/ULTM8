import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { WaiverResponse } from './waiverQueries';
import { useT } from '../i18n/I18nProvider';

/** Fields match CreateWaiverDto/UpdateWaiverDto exactly —
 * apps/api/src/waivers/dto/create-waiver.dto.ts. Both `title` and `body` are
 * required (no optional/nullable fields at all — unlike every other CRUD
 * form in this phase's own review, there's nothing here for the
 * null-clearing gap to apply to), so this modal is deliberately simpler than
 * ClassFormModal/InstructorFormModal/TimetableSlotFormModal/
 * MembershipPlanFormPage. */
export function WaiverFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<WaiverResponse>;
  submitting: boolean;
  onSubmit: (values: { title: string; body: string }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    body: initial?.body ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({ title: form.title, body: form.body });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('waivers.form.titleLabel')} htmlFor="waiver-title">
          <TextField required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        </Field>
        <Field label={t('waivers.form.bodyLabel')} htmlFor="waiver-body" hint={t('waivers.form.bodyHint')}>
          <TextArea
            required
            rows={12}
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
          />
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
