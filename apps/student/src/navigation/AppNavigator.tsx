import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from './HomeScreen';
import { AcademiesListScreen } from '../academies/AcademiesListScreen';
import { AcademyDetailScreen } from '../academies/AcademyDetailScreen';
import { MyBookingsScreen } from '../bookings/MyBookingsScreen';
import { MyMembershipsScreen } from '../memberships/MyMembershipsScreen';
import { NotificationsScreen } from '../notifications/NotificationsScreen';
import { WaiversScreen } from '../waivers/WaiversScreen';
import { MinorConsentScreen } from '../guardians/MinorConsentScreen';
import { MyMinorsScreen } from '../guardians/MyMinorsScreen';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'ULTM8 Student' }} />
      <Stack.Screen name="Academies" component={AcademiesListScreen} options={{ title: 'Academies' }} />
      <Stack.Screen
        name="AcademyDetail"
        component={AcademyDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: 'My Bookings' }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
      <Stack.Screen name="MyMemberships" component={MyMembershipsScreen} options={{ title: 'My Memberships' }} />
      <Stack.Screen name="Waivers" component={WaiversScreen} options={{ title: 'Waivers' }} />
      <Stack.Screen name="MyMinors" component={MyMinorsScreen} options={{ title: 'My Minors' }} />
      <Stack.Screen name="MinorConsent" component={MinorConsentScreen} options={({ route }) => ({ title: route.params.name })} />
    </Stack.Navigator>
  );
}
