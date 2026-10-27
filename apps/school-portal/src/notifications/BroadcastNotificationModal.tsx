import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { branchSelectOptions, type BranchResponse } from '../branches/branchQueries';
import type { ClassResponse } from '../classes/classQueries';
import type { BroadcastNotificationInput, BroadcastResponse } from './notificationQueries';

type AudienceScope = BroadcastNotificationInput['audience'];
type ClassGroup = NonNullable<BroadcastNotificationInput['classAudience']>[number];

/** Who on the Class's list gets it — the Owner ticks them (Decision 333). */
const CLASS_GROUPS: Array<{ value: ClassGroup; labelKey: TranslationKey }> = [
  { value: 'BOOKED', labelKey: 'notifications.broadcastModal.classGroupBooked' },
  { value: 'WAITLIST', labelKey: 'notifications.broadcastModal.classGroupWaitlist' },
  { value: 'CANCELLED', labelKey: 'notifications.broadcastModal.classGroupCancelled' },
];

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
  const [classGroups, setClassGroups] = useState<ClassGroup[]>(['BOOKED']);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<BroadcastResponse | null>(null);
  const t = useT();
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));
  // A weekly class repeats its title every week, so each option also carries
  // its own date, time and branch to tell the occurrences apart.
  const classLabel = (c: ClassResponse) => {
    const when = new Date(c.startDate).toLocaleString(formatLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const branch = c.branchId ? branchNames.get(c.branchId) : undefined;
    return [c.title, when, branch].filter(Boolean).join(' · ');
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError(t('notifications.broadcastModal.required'));
      return;
    }
    if (audience === 'BRANCH' && !branchId) {
      setError(t('notifications.broadcastModal.selectBranch'));
      return;
    }
    if (audience === 'CLASS' && !classId) {
      setError(t('notifications.broadcastModal.selectClass'));
      return;
    }
    if (audience === 'CLASS' && classGroups.length === 0) {
      setError(t('notifications.broadcastModal.selectClassGroup'));
      return;
    }
    try {
      const result = await onSubmit({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === 'BRANCH' ? { branchId } : {}),
        ...(audience === 'CLASS' ? { classId, classAudience: classGroups } : {}),
      });
      setSent(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('notifications.broadcastModal.failed'));
    }
  }

  if (sent) {
    return (
      <Modal title={t('notifications.broadcastModal.sentTitle')} onClose={onClose}>
        <p className="ultm8-field">
          {t('notifications.broadcastModal.sentTo', { count: sent.recipientCount })}
        </p>
        <Button type="button" onClick={onClose}>
          {t('common.done')}
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={t('notifications.broadcastModal.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('notifications.broadcastModal.titleLabel')} htmlFor="broadcast-title">
          <TextField id="broadcast-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('notifications.broadcastModal.messageLabel')} htmlFor="broadcast-body">
          <TextArea id="broadcast-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={5} />
        </Field>
        <Field label={t('notifications.broadcastModal.audienceLabel')} htmlFor="broadcast-audience" hint={t('notifications.broadcastModal.audienceHint')}>
          <SelectField
            id="broadcast-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as AudienceScope)}
            options={[
              { value: 'ALL', label: t('notifications.broadcastModal.audienceAll') },
              { value: 'BRANCH', label: t('notifications.broadcastModal.audienceBranch') },
              { value: 'CLASS', label: t('notifications.broadcastModal.audienceClass') },
            ]}
          />
        </Field>
        {audience === 'BRANCH' ? (
          <Field label={t('notifications.broadcastModal.branchLabel')} htmlFor="broadcast-branch">
            <SelectField
              id="broadcast-branch"
              required
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              options={[{ value: '', label: t('notifications.broadcastModal.branchPlaceholder') }, ...branchSelectOptions(branches, t('branches.archivedBadge'))]}
            />
          </Field>
        ) : null}
        {audience === 'CLASS' ? (
          <Field label={t('notifications.broadcastModal.classLabel')} htmlFor="broadcast-class">
            <SelectField
              id="broadcast-class"
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              options={[{ value: '', label: t('notifications.broadcastModal.classPlaceholder') }, ...classes.map((c) => ({ value: c.id, label: classLabel(c) }))]}
            />
          </Field>
        ) : null}
        {audience === 'CLASS' ? (
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
            <legend className="ultm8-field__label">{t('notifications.broadcastModal.classGroupsLabel')}</legend>
            {CLASS_GROUPS.map((g) => (
              <Checkbox
                key={g.value}
                label={t(g.labelKey)}
                checked={classGroups.includes(g.value)}
                onChange={(e) =>
                  setClassGroups((prev) => (e.target.checked ? [...prev, g.value] : prev.filter((v) => v !== g.value)))
                }
              />
            ))}
          </fieldset>
        ) : null}
        <Button type="submit" loading={submitting}>
          {t('notifications.broadcastModal.submit')}
        </Button>
      </form>
    </Modal>
  );
}
