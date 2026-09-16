import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from './HomeScreen';
import { AcademiesListScreen } from '../academies/AcademiesListScreen';
import { AcademyDetailScreen } from '../academies/AcademyDetailScreen';
import { MyBookingsScreen } from '../bookings/MyBookingsScreen';
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
    </Stack.Navigator>
  );
}
