import React from 'react';
import { AuthCard, Button } from '@ultm8/ui';
import { useAuth } from './AuthContext';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 451 item 2 (R-1; Decision 449 item 6) — where a coach or Branch
 * Staff member whose access to their School is paused lands after signing in,
 * instead of "Create your School": their access to the School has been
 * paused, and they should contact the School owner. No School data is shown;
 * the API refuses every School page to them with the same message.
 */
export function AccessPausedPage() {
  const t = useT();
  const { logout } = useAuth();
  return (
    <AuthCard
      title={t('auth.accessPausedTitle')}
      footer={
        <Button type="button" variant="secondary" onClick={() => void logout()}>
          {t('layout.logOut')}
        </Button>
      }
    >
      <p role="status">{t('server.codes.accessPaused')}</p>
    </AuthCard>
  );
}
