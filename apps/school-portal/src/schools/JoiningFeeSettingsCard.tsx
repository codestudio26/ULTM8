import React, { useState } from 'react';
import { Button, Card, Checkbox, ErrorBanner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

/**
 * Decision 316 item 3 / Decision 435: joining fees on or off for the School
 * (off by default). Each paid plan sets its own fee and whether it is
 * refunded; it is added to a member's first-ever plan here. Switched off, the
 * fees stay saved on the plans but nothing is charged (item 6). Owner only,
 * as the rest of the School page's settings.
 */
export function JoiningFeeSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [enabled, setEnabled] = useState(school.joiningFeesEnabled ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ joiningFeesEnabled: enabled });
      setEnabled(updated.joiningFeesEnabled);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} data-testid="joining-fee-settings">
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.joiningFees.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.joiningFees.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Checkbox
          label={t('schools.joiningFees.enabled')}
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
        />
        <p style={{ fontSize: 13, opacity: 0.75 }}>{t('schools.joiningFees.offNote')}</p>
        <Button type="submit" loading={update.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}
