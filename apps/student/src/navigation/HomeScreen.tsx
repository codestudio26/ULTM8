import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { spacing, fontSize, fontWeight } from '../theme/tokens';
import { useAuth, useCoachSchoolId, useEnrolledSchoolIds, useIsGuardian } from '../auth/AuthContext';
import type { AppStackParamList } from './types';

type Props = NativeStackScreenProps<AppStackParamList, 'Home'>;

/** CANDIDATE UI (the "My minors" button + section below) — Guardian is a
 * regular User with a GUARDIAN RoleGrant, using the identical login/JWT shape
 * as Student (confirmed: `Role` enum in schema.prisma, same `grants` array
 * this app already reads elsewhere), not a separate app — so this screen
 * additively shows Guardian-facing options when that grant is present, rather
 * than assuming every logged-in User is Student-only. A person can plausibly
 * hold both roles at once (e.g. a Guardian who also trains themselves), so
 * this doesn't replace the Student options, it adds to them. */
export function HomeScreen({ navigation }: Props) {
  const { logout } = useAuth();
  const isGuardian = useIsGuardian();
  const isCoach = !!useCoachSchoolId();
  const isStudent = useEnrolledSchoolIds().length > 0;

  return (
    <Screen>
      <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading, marginBottom: spacing[6] }}>ULTM8 Student</Text>
      {isCoach ? <Button title="Coach dashboard" onPress={() => navigation.navigate('CoachDashboard')} /> : null}
      <Button title="Browse academies" onPress={() => navigation.navigate('Academies')} />
      <Button title="Check in" onPress={() => navigation.navigate('QrCheckIn')} />
      {isStudent ? <Button title="My grading" onPress={() => navigation.navigate('MyGrading')} /> : null}
      <Button title="My bookings" onPress={() => navigation.navigate('MyBookings')} />
      <Button title="My memberships" onPress={() => navigation.navigate('MyMemberships')} />
      <Button title="Waivers" onPress={() => navigation.navigate('Waivers')} />
      <Button title="Notifications" onPress={() => navigation.navigate('Notifications')} />
      {isGuardian ? <Button title="My minors" onPress={() => navigation.navigate('MyMinors')} /> : null}
      {isGuardian ? <Button title="Kid Mode" onPress={() => navigation.navigate('KidModePin')} /> : null}
      {isGuardian ? (
        <Button title="Needs your review" variant="secondary" onPress={() => navigation.navigate('PendingReview')} />
      ) : null}
      <Button title="Log out" variant="secondary" onPress={() => logout()} />
    </Screen>
  );
}
