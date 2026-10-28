import React, { useState } from 'react';
import { Button, ErrorBanner, Modal } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';

/**
 * "Delete X?" with the reason it can't be, when the API refuses (Decision 198:
 * only what has never been used can be deleted; anything in a student's
 * record stays). The API's 409 message says what is using it.
 *
 * `confirmLabel`/`genericErrorMessage` (v1.2 backend backlog — Revoke
 * Enrollment on Student/Instructor Detail) — optional, additive, defaulting
 * to this component's original Delete-only wording (translated at render
 * time when the caller passes nothing), so every existing caller
 * (DisciplinesPage, DisciplineDetailPage, LadderSection, CurriculumPage) is
 * unaffected. Lets a differently-destructive action (e.g. "Revoke") reuse
 * this same house confirmation pattern instead of a new one-off modal.
 */
export function ConfirmDeleteModal({
  title,
  description,
  confirmLabel,
  genericErrorMessage,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description: string;
  /** Shown under the description, e.g. what Revoke will also end. */
  children?: React.ReactNode;
  confirmLabel?: string;
  genericErrorMessage?: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (genericErrorMessage ?? t('lib.confirmDelete.failed')));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{description}</p>
      {children}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" onClick={confirm} loading={busy} disabled={!!error}>
          {confirmLabel ?? t('lib.confirmDelete.delete')}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {error ? t('lib.confirmDelete.close') : t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
