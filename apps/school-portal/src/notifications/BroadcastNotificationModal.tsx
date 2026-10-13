import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import type { ClassResponse } from '../classes/classQueries';
import type { BroadcastNotificationInput, BroadcastResponse } from './notificationQueries';

type AudienceScope = BroadcastNotificationInput['audience'];

/**
 * Broadcast/compose — the single biggest gap the "Notifications page" v1.2
 * backend backlog entry flagged this session, now approved and built: a
 * School Owner authoring and sending a Notification to Students, with
 * Branch/Class audience targeting (POST
 * /schools/:schoolId/notifications/broadcast). Same form-modal house style as
 * InviteToInstructorRoleModal (find-then-confirm there; here it's
 * compose-then-confirm-audience, closer to WaiverFormModal's own single-step
 * shape).
 */
export function BroadcastNotificationModal({
  branches,
  classes,
  submitting,
  onSubmit,
  onClose,
}: {
  branches: BranchResponse[];
  classes: ClassResponse[];
  submitting: boolean;
  onSubmit: (input: BroadcastNotificationInput) => Promise<BroadcastResponse>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<AudienceScope>('ALL');
  const [branchId, setBranchId] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<BroadcastResponse | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError('Title and message are both required.');
      return;
    }
    if (audience === 'BRANCH' && !branchId) {
      setError('Select the Branch to notify.');
      return;
    }
    if (audience === 'CLASS' && !classId) {
      setError('Select the Class to notify.');
      return;
    }
    try {
      const result = await onSubmit({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === 'BRANCH' ? { branchId } : {}),
        ...(audience === 'CLASS' ? { classId } : {}),
      });
      setSent(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send this broadcast — please try again.');
    }
  }

  if (sent) {
    return (
      <Modal title="Broadcast sent" onClose={onClose}>
        <p className="ultm8-field">
          Sent to <strong>{sent.recipientCount}</strong> Student{sent.recipientCount === 1 ? '' : 's'}.
        </p>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title="Broadcast to Students" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Title" htmlFor="broadcast-title">
          <TextField id="broadcast-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Message" htmlFor="broadcast-body">
          <TextArea id="broadcast-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} />
        </Field>
        <Field label="Send to" htmlFor="broadcast-audience" hint="All Students at your School, one Branch, or everyone booked into one Class.">
          <SelectField
            id="broadcast-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as AudienceScope)}
            options={[
              { value: 'ALL', label: 'All Students' },
              { value: 'BRANCH', label: 'Students at a Branch' },
              { value: 'CLASS', label: 'Students booked into a Class' },
            ]}
          />
        </Field>
        {audience === 'BRANCH' ? (
          <Field label="Branch" htmlFor="broadcast-branch">
            <SelectField
              id="broadcast-branch"
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[{ value: '', label: 'Select a Branch…' }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            />
          </Field>
        ) : null}
        {audience === 'CLASS' ? (
          <Field label="Class" htmlFor="broadcast-class">
            <SelectField
              id="broadcast-class"
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              options={[{ value: '', label: 'Select a Class…' }, ...classes.map((c) => ({ value: c.id, label: c.title }))]}
            />
          </Field>
        ) : null}
        <Button type="submit" loading={submitting}>
          Send broadcast
        </Button>
      </form>
    </Modal>
  );
}
