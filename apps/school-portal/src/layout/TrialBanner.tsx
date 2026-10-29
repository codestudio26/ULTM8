import React from 'react';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useT } from '../i18n/I18nProvider';

const DAY_MS = 86_400_000;

/**
 * Backlog 3.14 (Decision 318 item 5): the owner of a School on a free trial
 * of ULTM8 sees how many days are left; once it has ended without a platform
 * subscription, that the portal is read-only until they subscribe (once it
 * subscribes, the School read sends no trial dates). ULTM8 HQ
 * starts and extends trials in Platform Admin; nothing here changes them.
 */
export function TrialBanner() {
  const t = useT();
  const school = useSchool(useOwnedSchoolId()).data;
  if (!school?.platformTrialEndsAt) return null;
  const left = Math.ceil((new Date(school.platformTrialEndsAt).getTime() - Date.now()) / DAY_MS);
  return (
    <div
      role="status"
      style={{
        margin: '0 0 16px',
        padding: '10px 14px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: left > 0 ? 'var(--surface-1, transparent)' : 'var(--color-danger-50, transparent)',
      }}
    >
      {left > 0 ? t('layout.trial.daysLeft', { count: left }) : t('layout.trial.ended')}
    </div>
  );
}
