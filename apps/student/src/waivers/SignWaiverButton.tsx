import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/ui';
import { useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from '../navigation/types';

/**
 * Decision 442 item 1: "Sign the waiver", shown next to the refusal when the
 * School needs a signed waiver before booking, joining or claiming a
 * waiting-list place, or checking in (isWaiverRefusal). It opens the existing
 * signing screens: My waivers for the member's own, or a parent's
 * ChildWaivers for their child, limited to that School when it is known.
 */
export function SignWaiverButton({
  schoolId,
  child,
}: {
  /** The School that refused; unknown (null) lists every School's waivers. */
  schoolId?: string | null;
  /** A parent acting for their child. */
  child?: { studentId: string; name: string };
}) {
  const t = useT();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const school = schoolId ? { schoolId } : {};
  return (
    <View style={{ marginTop: 6 }}>
      <Button
        title={t('waivers.signTheWaiver')}
        variant="secondary"
        onPress={() =>
          child
            ? navigation.navigate('ChildWaivers', { studentId: child.studentId, name: child.name, ...school })
            : navigation.navigate('Waivers', schoolId ? { schoolId } : undefined)
        }
      />
    </View>
  );
}
