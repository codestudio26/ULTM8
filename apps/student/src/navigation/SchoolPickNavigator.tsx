import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SchoolPickScreen } from '../academies/SchoolPickScreen';
import type { SchoolPickStackParamList } from './types';

const Stack = createNativeStackNavigator<SchoolPickStackParamList>();

/** Decision 266 — a one-screen stack (see SchoolPickStackParamList's own
 * comment for why this is a Navigator at all rather than just rendering
 * SchoolPickScreen directly: consistency with AuthNavigator/AppNavigator's
 * own shape, and room to grow without another RootNavigator change if a
 * second pre-pick screen is ever needed). */
export function SchoolPickNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SchoolPick" component={SchoolPickScreen} />
    </Stack.Navigator>
  );
}
