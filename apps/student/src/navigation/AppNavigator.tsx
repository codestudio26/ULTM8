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
import { KidModePinScreen } from '../kidmode/KidModePinScreen';
import { KidModeBookingScreen } from '../kidmode/KidModeBookingScreen';
import { PendingReviewScreen } from '../kidmode/PendingReviewScreen';
import { QrCheckInScreen } from '../attendance/QrCheckInScreen';
import { CoachDashboardScreen } from '../coach/CoachDashboardScreen';
import { GradingBoardScreen } from '../coach/GradingBoardScreen';
import { CoachStudentScreen } from '../coach/CoachStudentScreen';
import { MyGradingScreen } from '../grading/MyGradingScreen';
import { GradingHistoryScreen } from '../grading/GradingHistoryScreen';
import { useCoachSchoolId } from '../auth/AuthContext';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Coaches (Instructors and Branch Staff) land on their dashboard; everyone
 * else on the student home (Decision 184 item 4). */
export function AppNavigator() {
  const coachSchoolId = useCoachSchoolId();
  return (
    <Stack.Navigator initialRouteName={coachSchoolId ? 'CoachDashboard' : 'Home'}>
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
      <Stack.Screen name="KidModePin" component={KidModePinScreen} options={{ title: 'Kid Mode' }} />
      <Stack.Screen name="KidModeBooking" component={KidModeBookingScreen} options={{ title: 'Kid Mode' }} />
      <Stack.Screen name="PendingReview" component={PendingReviewScreen} options={{ title: 'Needs Your Review' }} />
      <Stack.Screen name="QrCheckIn" component={QrCheckInScreen} options={{ title: 'Check In' }} />
      <Stack.Screen
        name="MyGrading"
        component={MyGradingScreen}
        options={({ route }) => ({ title: route.params?.name ? `${route.params.name}'s grading` : 'My Grading' })}
      />
      <Stack.Screen name="GradingHistory" component={GradingHistoryScreen} options={({ route }) => ({ title: route.params.title })} />
      <Stack.Screen name="CoachDashboard" component={CoachDashboardScreen} options={{ title: 'Coach' }} />
      <Stack.Screen name="GradingBoard" component={GradingBoardScreen} options={({ route }) => ({ title: `Grading Board — ${route.params.name}` })} />
      <Stack.Screen name="CoachStudent" component={CoachStudentScreen} options={({ route }) => ({ title: route.params.name })} />
    </Stack.Navigator>
  );
}
