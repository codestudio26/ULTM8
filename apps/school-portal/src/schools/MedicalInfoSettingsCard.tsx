import React, { useState } from 'react';
import { Button, Card, ErrorBanner, SuccessBanner, Switch } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

/**
 * Decision 315 item 10: whether the School asks for medical information at
 * sign-up (the front-desk tablet, and joining in the ULTM8 app). Off by
 * default. It stays optional for the member and is kept only with their
 * consent (their Guardian's for a child); only owners and staff given "See
 * medical information" can read it.
 */
export function MedicalInfoSettingsCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [enabled, setEnabled] = useState<boolean>(school.medicalInfoEnabled ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ medicalInfoEnabled: enabled });
      setEnabled(updated.medicalInfoEnabled);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form id="medical-info" onSubmit={save}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.medicalInfo.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.medicalInfo.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Switch
          id="medical-info-enabled"
          label={t('schools.medicalInfo.enabled')}
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            setSaved(false);
          }}
        />
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={update.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
