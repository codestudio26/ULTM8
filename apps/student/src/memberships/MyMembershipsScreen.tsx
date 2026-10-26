import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { formatDate } from '../lib/formatDate';
import { useMyMemberships } from './membershipQueries';
import { getRememberedPlanName } from './planNameCache';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

const MEMBERSHIP_STATUS: Record<string, TranslationKey> = {
  ACTIVE: 'memberships.statusLabel.active',
  EXPIRED: 'memberships.statusLabel.expired',
};

type Membership = components['schemas']['MembershipResponseDto'];

/** Read-only — MembershipStatus is ACTIVE/EXPIRED (apps/api/prisma/schema.prisma),
 * both fully-resolved states with no client action to gate here. `MembershipResponseDto`
 * has no denormalized plan title, only `membershipPlanId` — resolved via
 * `planNameCache` (populated whenever AcademyDetailScreen fetches a School's plans),
 * falling back to the raw id only for a plan the Student never browsed that way. */
function MembershipRow({ membership }: { membership: Membership }) {
  const t = useT();
  const planName =
    getRememberedPlanName(membership.membershipPlanId) ?? t('memberships.myMemberships.planFallback', { planId: membership.membershipPlanId });
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
