import React from 'react';
import { Text, View } from 'react-native';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
import { useT } from '../i18n/I18nProvider';
import { usePlanWaitlist, type PlanAvailability } from './planWaitlistQueries';

/**
 * Decision 435 items 10-15 on a plan row: a full plan offers its waiting list
 * instead of Purchase; someone in line sees their place and can leave; once a
 * place is held for them (24 hours), they see until when, and the row's own
 * Purchase buttons show (MembershipPlanRow).
 */
export function PlanWaitlistControls({ planId, availability, forStudentId }: { planId: string; availability: PlanAvailability; forStudentId?: string }) {
  const t = useT();
  const { join, leave } = usePlanWaitlist();
  const entry = availability.waitlist;
  const error = join.error ?? leave.error;

  if (entry?.status === 'OFFERED' && entry.offerExpiresAt) {
    return <Text style={{ color: '#188038', fontSize: 13, marginTop: 4 }}>{t('memberships.planRow.placeHeld', { date: formatDateTime(entry.offerExpiresAt) })}</Text>;
  }
  return (
    <View style={{ marginTop: 4 }}>
      {error ? <InlineError message={getApiErrorMessage(error, t('memberships.planRow.waitlistError'))} /> : null}
      {entry ? (
        <>
          <Text style={{ color: '#5F6368', fontSize: 13 }}>{t('memberships.planRow.onWaitlist', { position: entry.position ?? 1 })}</Text>
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Button title={t('memberships.planRow.leaveWaitlist')} variant="secondary" loading={leave.isPending} onPress={() => leave.mutate({ planId, studentId: forStudentId })} />
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: '#B06000', fontSize: 13 }}>{t('memberships.planRow.full')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Button title={t('memberships.planRow.joinWaitlist')} loading={join.isPending} onPress={() => join.mutate({ planId, studentId: forStudentId })} />
          </View>
        </>
      )}
    </View>
  );
}
