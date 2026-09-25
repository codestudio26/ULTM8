import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { useAuth, useIsGuardian } from '../auth/AuthContext';
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

  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 20 }}>ULTM8 Student</Text>
      <Button title="Browse academies" onPress={() => navigation.navigate('Academies')} />
      <Button title="My bookings" onPress={() => navigation.navigate('MyBookings')} />
      <Button title="My memberships" onPress={() => navigation.navigate('MyMemberships')} />
      <Button title="Waivers" onPress={() => navigation.navigate('Waivers')} />
      <Button title="Notifications" onPress={() => navigation.navigate('Notifications')} />
      {isGuardian ? <Button title="My minors" onPress={() => navigation.navigate('MyMinors')} /> : null}
      <Button title="Log out" variant="secondary" onPress={() => logout()} />
    </Screen>
  );
}
