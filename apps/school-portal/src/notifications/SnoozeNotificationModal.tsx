import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';

/** Preset durations (minutes) — a common inbox-Snooze shape (Gmail/Outlook
 * both offer a short list of presets rather than a free-form date/time
 * picker), and this package has no dedicated date/time-picker component yet.
 * `minutes` is the body shape SnoozeNotificationDto accepts alongside an
 * explicit `until` timestamp — this modal only ever sends `minutes`, since a
 * relative preset is simpler for a caller than computing an absolute
 * timestamp client-side. Capped at 10,080 (7 days), matching the DTO's own
 * upper bound. */
const SNOOZE_PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: 'Tomorrow (24 hours)', minutes: 1_440 },
  { label: '3 days', minutes: 4_320 },
  { label: '1 week', minutes: 10_080 },
];

/** Snooze — the row action menu item the v1.2 backend backlog previously
 * flagged as "shown, disabled-styled" with no real endpoint behind it; now
 * real (PATCH /notifications/:id/snooze, approved by the product owner). */
export function SnoozeNotificationModal({
  title,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  submitting: boolean;
  onSubmit: (minutes: number) => Promise<void>;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState(SNOOZE_PRESETS[0].minutes);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit(minutes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not snooze this notification — please try again.');
    }
  }

  return (
    <Modal title="Snooze notification" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p className="ultm8-field">
          Hide <strong>{title}</strong> from your unread count until the time you choose. It returns to your unread
          list automatically once that time passes.
        </p>
        <Field label="Snooze for" htmlFor="snooze-minutes">
          <SelectField
            id="snooze-minutes"
            value={String(minutes)}
            onChange={(e) => setMinutes(Number(e.target.value))}
            options={SNOOZE_PRESETS.map((p) => ({ value: String(p.minutes), label: p.label }))}
          />
        </Field>
        <Button type="submit" loading={submitting}>
          Snooze
        </Button>
      </form>
    </Modal>
  );
}
