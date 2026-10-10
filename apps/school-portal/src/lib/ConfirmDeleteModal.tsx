import React, { useState } from 'react';
import { Button, ErrorBanner, Modal } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';

/**
 * "Delete X?" with the reason it can't be, when the API refuses (Decision 198:
 * only what has never been used can be deleted; anything in a student's
 * record stays). The API's 409 message says what is using it.
 */
export function ConfirmDeleteModal({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
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
      setError(err instanceof ApiError ? err.message : 'Could not delete. Please try again.');
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
          Delete
        </Button>
        <Button variant="secondary" onClick={onClose}>
          {error ? 'Close' : 'Cancel'}
        </Button>
      </div>
    </Modal>
  );
}
