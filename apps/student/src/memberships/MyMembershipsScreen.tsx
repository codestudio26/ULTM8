import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { useCancelSubscription, useMyMemberships } from './membershipQueries';
import { getRememberedPlanName } from './planNameCache';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

const MEMBERSHIP_STATUS: Record<string, TranslationKey> = {
  ACTIVE: 'memberships.statusLabel.active',
  EXPIRED: 'memberships.statusLabel.expired',
};

type Membership = components['schemas']['MyMembershipResponseDto'];

/** MembershipStatus is ACTIVE/EXPIRED (apps/api/prisma/schema.prisma). The one
 * action is cancelling a live Subscription (Decision 348): it runs to the end of
 * the paid month, so the row then shows when it ends. Confirmed in an inline
 * panel, not Alert.alert (a no-op on React Native Web; see MyBookingsScreen).
 * `MembershipResponseDto`
 * has no denormalized plan title, only `membershipPlanId` — resolved via
 * `planNameCache` (populated whenever AcademyDetailScreen fetches a School's plans),
 * falling back to the raw id only for a plan the Student never browsed that way. */
export function MembershipRow({ membership }: { membership: Membership }) {
  const t = useT();
  const cancel = useCancelSubscription();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel = membership.frequency === 'RECURRING' && membership.status === 'ACTIVE' && !membership.cancelAt;

  async function confirmCancel() {
    if (cancel.isPending) return;
    setConfirming(false);
    setError(null);
    try {
      await cancel.mutateAsync(membership.id);
    } catch (err) {
      setError(getApiErrorMessage(err, t('memberships.myMemberships.cancelError')));
    }
  }

  // Decision 391: a visit pass's plan is hidden from the School's plan list.
  const planName = membership.visitPass
    ? t('memberships.myMemberships.visitPass')
    : getRememberedPlanName(membership.membershipPlanId) ?? t('memberships.myMemberships.planFallback', { planId: membership.membershipPlanId });
  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>{planName}</Text>
      <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>
        {t('memberships.myMemberships.statusLine', {
          status: MEMBERSHIP_STATUS[membership.status] ? t(MEMBERSHIP_STATUS[membership.status]) : membership.status,
          frequency: membership.frequency === 'RECURRING' ? t('memberships.myMemberships.recurring') : t('memberships.myMemberships.oneTime'),
        })}
      </Text>
      {membership.classesRemaining != null ? (
        <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('memberships.myMemberships.classesRemaining', { count: membership.classesRemaining })}</Text>
      ) : null}
      {membership.expiryDate ? <Text style={{ color: '#9AA0A6', fontSize: 11, marginTop: 2 }}>{t('memberships.myMemberships.expires', { date: formatDate(membership.expiryDate) })}</Text> : null}
      {membership.cancelAt && membership.status === 'ACTIVE' ? (
        <Text style={{ color: '#B06000', fontSize: 12, marginTop: 2 }}>{t('memberships.myMemberships.cancelledEnds', { date: formatDate(membership.cancelAt) })}</Text>
      ) : null}
      {error ? <InlineError message={error} /> : null}
      {canCancel && confirming ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#C5221F', fontSize: 13 }}>{t('memberships.myMemberships.cancelConfirm')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.keepSubscription')} variant="secondary" onPress={() => setConfirming(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.cancelSubscription')} variant="destructive" onPress={confirmCancel} loading={cancel.isPending} />
            </View>
          </View>
        </View>
      ) : canCancel ? (
        <View style={{ marginTop: 8 }}>
          <Button title={t('memberships.myMemberships.cancelSubscription')} variant="secondary" onPress={() => setConfirming(true)} loading={cancel.isPending} />
        </View>
      ) : null}
    </View>
  );
}

export function MyMembershipsScreen() {
  const t = useT();
  const query = useMyMemberships();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Membership) => <MembershipRow membership={item} />}
      emptyMessage={t('memberships.myMemberships.empty')}
      errorFallbackMessage={t('memberships.myMemberships.loadError')}
    />
  );
}
