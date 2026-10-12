import React, { useState } from 'react';
import { Button, ErrorBanner, Modal } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';

/**
 * "Delete X?" with the reason it can't be, when the API refuses (Decision 198:
 * only what has never been used can be deleted; anything in a student's
 * record stays). The API's 409 message says what is using it.
 *
 * `confirmLabel`/`genericErrorMessage` (v1.2 backend backlog — Revoke
 * Enrollment on Student/Instructor Detail) — optional, additive, defaulting
 * to this component's original Delete-only wording, so every existing caller
 * (DisciplinesPage, DisciplineDetailPage, LadderSection, CurriculumPage) is
 * unaffected. Lets a differently-destructive action (e.g. "Revoke") reuse
 * this same house confirmation pattern instead of a new one-off modal.
 */
export function ConfirmDeleteModal({
  title,
  description,
  confirmLabel = 'Delete',
  genericErrorMessage = 'Could not delete. Please try again.',
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  genericErrorMessage?: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : genericErrorMessage);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p style={{ marginTop: 0 }}>{description}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="danger" onClick={confirm} loading={busy} disabled={!!error}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {error ? 'Close' : 'Cancel'}
        </Button>
      </div>
    </Modal>
  );
}
