import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useMyMemberships } from './membershipQueries';
import { getRememberedPlanName } from './planNameCache';

type Membership = components['schemas']['MembershipResponseDto'];

/** Read-only — MembershipStatus is ACTIVE/EXPIRED (apps/api/prisma/schema.prisma),
 * both fully-resolved states with no client action to gate here. `MembershipResponseDto`
 * has no denormalized plan title, only `membershipPlanId` — resolved via
 * `planNameCache` (populated whenever AcademyDetailScreen fetches a School's plans),
 * falling back to the raw id only for a plan the Student never browsed that way. */
function MembershipRow({ membership }: { membership: Membership }) {
  const planName = getRememberedPlanName(membership.membershipPlanId) ?? `Plan ${membership.membershipPlanId}`;
  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading }}>{planName}</Text>
      <Text style={{ color: theme.textSecondary, marginTop: spacing[1], fontSize: fontSize.caption }}>
        Status: {membership.status} · {membership.frequency === 'RECURRING' ? 'Recurring' : 'One time'}
      </Text>
      {membership.classesRemaining != null ? (
        <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption }}>{membership.classesRemaining} classes remaining</Text>
      ) : null}
      {membership.expiryDate ? (
        <Text style={{ color: theme.textMuted, fontSize: fontSize.caption, marginTop: spacing[1] }}>
          Expires {formatDate(membership.expiryDate)}
        </Text>
      ) : null}
    </View>
  );
}

export function MyMembershipsScreen() {
  const query = useMyMemberships();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Membership) => <MembershipRow membership={item} />}
      emptyMessage="No memberships yet."
      errorFallbackMessage="Failed to load memberships — please try again."
    />
  );
}
