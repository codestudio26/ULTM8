import React from 'react';
import { EmptyState } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import '../team/teamLook.css';

/** Coach invites used to be open to Branch Staff given "Can invite
 * coaches" (Decision 183). Only the School's main owner adds people now
 * (Decision 423 item 10) and invites from the Staff page, so this old
 * address only says so, in the new look's page header and card. */
export function CoachInvitesPage() {
  const t = useT();
  return (
    <>
      <NewLookPageHeader title={t('coach.invites.title')} />
      <NewLookPage>
        <section className="u8t-card">
          <div className="u8t-state">
            <EmptyState title={t('coach.invites.cannotTitle')} description={t('roleGrants.staff.mainOwnerOnly')} />
          </div>
        </section>
      </NewLookPage>
    </>
  );
}
