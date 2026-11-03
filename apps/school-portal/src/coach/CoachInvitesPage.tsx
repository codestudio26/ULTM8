import React from 'react';
import { Card, EmptyState, PageHeader } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';

/** Coach invites used to be open to Branch Staff given "Can invite
 * coaches" (Decision 183). Only the School's main owner adds people now
 * (Decision 423 item 10) and invites from the Staff page, so this old
 * address only says so. */
export function CoachInvitesPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('coach.invites.title')} />
      <Card>
        <EmptyState title={t('coach.invites.cannotTitle')} description={t('roleGrants.staff.mainOwnerOnly')} />
      </Card>
    </>
  );
}
