import React from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import type { AppStackParamList } from './types';

type Props = NativeStackScreenProps<AppStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { logout } = useAuth();

  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 20 }}>ULTM8 Student</Text>
      <Button title="Browse academies" onPress={() => navigation.navigate('Academies')} />
      <Button title="My bookings" onPress={() => navigation.navigate('MyBookings')} />
      <Button title="Notifications" onPress={() => navigation.navigate('Notifications')} />
      <Button title="Log out" variant="secondary" onPress={() => logout()} />
    </Screen>
  );
}
