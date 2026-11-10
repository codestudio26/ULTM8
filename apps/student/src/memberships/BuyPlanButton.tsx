import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/ui';
import { useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from '../navigation/types';

/**
 * Decision 449 item 8: "Buy a plan", shown next to a refusal because none of
 * the member's plans pays for the class (isPlanRefusal). It opens that
 * School's plans: the School's page for the member's own (or `onShowPlans`,
 * when the refusal is already on that page and only needs to scroll to
 * them), or a parent's ChildPlans for their child, at that School. Not in
 * Kid Mode, where a child can't buy, and never in the School Portal.
 */
export function BuyPlanButton({
  schoolId,
  schoolName,
  child,
  onShowPlans,
}: {
  schoolId: string;
  /** The School's name, for the page title. */
  schoolName?: string | null;
  /** A parent acting for their child. */
  child?: { studentId: string; name: string };
  /** The plans are on this same screen: show them instead of opening a page. */
  onShowPlans?: () => void;
}) {
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  return (
    <View style={{ marginTop: 6 }}>
      <Button
        title={t('bookings.classRow.buyPlan')}
        variant="secondary"
        onPress={() =>
          child
            ? navigation.navigate('ChildPlans', { studentId: child.studentId, name: child.name, schoolId })
            : onShowPlans
              ? onShowPlans()
              : navigation.navigate('AcademyDetail', { academyId: schoolId, name: schoolName ?? '' })
        }
      />
    </View>
  );
}
