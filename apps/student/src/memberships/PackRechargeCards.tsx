import React from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useT } from '../i18n/I18nProvider';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { MembershipPlanRow } from './MembershipPlanRow';

/**
 * Home: "Your Class Pack has run out" (Decision 393, Decision 316 item 7).
 * The front desk found the pack used up at check-in and offered the same one
 * here, for the member or (for a Guardian) their child. Once it's paid, the
 * desk finishes the check-in. Checked often while open, since the desk waits.
 */
export function PackRechargeCards() {
  const t = useT();
  const recharges = useQuery({
    queryKey: ['pack-recharges'],
    queryFn: () => unwrap(apiClient.GET('/v1/pack-recharges/me')),
    refetchInterval: 15_000,
  });
  const items = recharges.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <>
      {items.map((r) => (
        <View key={r.id} style={{ marginBottom: spacing[4], backgroundColor: theme.bgWarning, borderRadius: radius.button, padding: spacing[4] }}>
          <Text accessibilityRole="header" style={{ fontWeight: '600', color: theme.textWarning }}>
            {r.childFirstName ? t('memberships.recharge.titleChild', { name: r.childFirstName }) : t('memberships.recharge.title')}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>
            {t('memberships.recharge.body', { school: r.schoolName })}
          </Text>
          <MembershipPlanRow plan={r.plan} schoolId={r.schoolId} forStudentId={r.childFirstName ? r.studentId : undefined} />
        </View>
      ))}
    </>
  );
}
