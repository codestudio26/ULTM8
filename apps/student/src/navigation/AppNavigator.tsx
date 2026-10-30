import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from './HomeScreen';
import { ProfileScreen } from '../profile/ProfileScreen';
import { AcademiesListScreen } from '../academies/AcademiesListScreen';
import { JoinSchoolScreen } from '../academies/JoinSchoolScreen';
import { AcademyDetailScreen } from '../academies/AcademyDetailScreen';
import { MyBookingsScreen } from '../bookings/MyBookingsScreen';
import { MyMembershipsScreen } from '../memberships/MyMembershipsScreen';
import { TransactionHistoryScreen } from '../transactions/TransactionHistoryScreen';
import { NotificationsScreen } from '../notifications/NotificationsScreen';
import { WaiversScreen } from '../waivers/WaiversScreen';
import { PaymentMethodsScreen } from '../payments/PaymentMethodsScreen';
import { LessonsScreen } from '../curriculum/LessonsScreen';
import { LessonDetailScreen } from '../curriculum/LessonDetailScreen';
import { PlaylistsScreen } from '../curriculum/PlaylistsScreen';
import { PlaylistDetailScreen } from '../curriculum/PlaylistDetailScreen';
import { MinorConsentScreen } from '../guardians/MinorConsentScreen';
import { ChildBookingScreen } from '../guardians/ChildBookingScreen';
import { MyMinorsScreen } from '../guardians/MyMinorsScreen';
import { KidModePinScreen } from '../kidmode/KidModePinScreen';
import { KidModeBookingScreen } from '../kidmode/KidModeBookingScreen';
import { PendingReviewScreen } from '../kidmode/PendingReviewScreen';
import { QrCheckInScreen } from '../attendance/QrCheckInScreen';
import { SchoolNotesScreen } from '../notes/SchoolNotesScreen';
import { CoachDashboardScreen } from '../coach/CoachDashboardScreen';
import { GradingBoardScreen } from '../coach/GradingBoardScreen';
import { CoachStudentScreen } from '../coach/CoachStudentScreen';
import { MyGradingScreen } from '../grading/MyGradingScreen';
import { MyChargesScreen } from '../charges/MyChargesScreen';
import { GradingHistoryScreen } from '../grading/GradingHistoryScreen';
import { useCoachSchoolId, useAuth, useEnrolledSchoolIds } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Coaches (Instructors and Branch Staff) land on their dashboard; everyone
 * else on the student home (Decision 184 item 4) — UNLESS Decision 266's
 * pre-auth School-pick screen has a pending pick this now-signed-in Student
 * hasn't actually joined yet (a brand-new installer who just registered),
 * in which case JoinSchoolScreen wins over both: finishing the pick they
 * started takes priority over landing on either dashboard. Checked against
 * useEnrolledSchoolIds(), not just "pendingSchoolPick is set" — the pick
 * only needs finishing once; after JoinSchoolScreen's own success path
 * clears it, this falls through to the ordinary coach/student branch on
 * every later launch, including re-logins. */
export function AppNavigator() {
  const t = useT();
  const coachSchoolId = useCoachSchoolId();
  const { pendingSchoolPick } = useAuth();
  const enrolledSchoolIds = useEnrolledSchoolIds();
  const needsToJoinPickedSchool = !!pendingSchoolPick && !enrolledSchoolIds.includes(pendingSchoolPick.id);

  const initialRouteName = needsToJoinPickedSchool ? 'JoinSchool' : coachSchoolId ? 'CoachDashboard' : 'Home';

  return (
    <Stack.Navigator initialRouteName={initialRouteName}>
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: t('navigation.app.home') }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t('navigation.app.profile') }} />
      <Stack.Screen name="Academies" component={AcademiesListScreen} options={{ title: t('navigation.app.academies') }} />
      <Stack.Screen
        name="AcademyDetail"
        component={AcademyDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen
        name="JoinSchool"
        component={JoinSchoolScreen}
        initialParams={needsToJoinPickedSchool ? { academyId: pendingSchoolPick!.id, name: pendingSchoolPick!.name } : undefined}
        options={({ route }) => ({ title: route.params.beltsFor ? t('navigation.app.addBelt') : t('navigation.app.joinSchool', { name: route.params.name }) })}
      />
      <Stack.Screen name="MyBookings" component={MyBookingsScreen} options={{ title: t('navigation.app.myBookings') }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: t('navigation.app.notifications') }} />
      <Stack.Screen name="MyMemberships" component={MyMembershipsScreen} options={{ title: t('navigation.app.myMemberships') }} />
      <Stack.Screen name="TransactionHistory" component={TransactionHistoryScreen} options={{ title: t('navigation.app.paymentHistory') }} />
      <Stack.Screen name="Waivers" component={WaiversScreen} options={{ title: t('navigation.app.waivers') }} />
      <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: t('navigation.app.paymentMethods') }} />
      <Stack.Screen
        name="Lessons"
        component={LessonsScreen}
        options={({ route }) => ({ title: route.params?.name ? t('navigation.app.childLessons', { name: route.params.name }) : t('navigation.app.lessons') })}
      />
      <Stack.Screen
        name="LessonDetail"
        component={LessonDetailScreen}
        options={({ route }) => ({ title: route.params.lesson.title })}
      />
      <Stack.Screen name="Playlists" component={PlaylistsScreen} options={{ title: t('navigation.app.myPlaylists') }} />
      <Stack.Screen
        name="PlaylistDetail"
        component={PlaylistDetailScreen}
        options={({ route }) => ({ title: route.params.name })}
      />
      <Stack.Screen name="MyMinors" component={MyMinorsScreen} options={{ title: t('navigation.app.myMinors') }} />
      <Stack.Screen name="MinorConsent" component={MinorConsentScreen} options={({ route }) => ({ title: route.params.name })} />
      <Stack.Screen
        name="ChildBooking"
        component={ChildBookingScreen}
        options={({ route }) => ({ title: t('guardians.childBooking.title', { name: route.params.name }) })}
      />
      <Stack.Screen name="KidModePin" component={KidModePinScreen} options={{ title: t('navigation.app.kidMode') }} />
      <Stack.Screen name="KidModeBooking" component={KidModeBookingScreen} options={{ title: t('navigation.app.kidMode') }} />
      <Stack.Screen name="PendingReview" component={PendingReviewScreen} options={{ title: t('navigation.app.needsReview') }} />
      <Stack.Screen name="QrCheckIn" component={QrCheckInScreen} options={{ title: t('navigation.app.checkIn') }} />
      <Stack.Screen name="SchoolNotes" component={SchoolNotesScreen} options={({ route }) => ({ title: route.params?.name ? t('navigation.app.childNotes', { name: route.params.name }) : t('navigation.app.schoolNotes') })} />
      <Stack.Screen
        name="MyCharges"
        component={MyChargesScreen}
        options={({ route }) => ({ title: route.params?.name ? t('charges.childTitle', { name: route.params.name }) : t('charges.title') })}
      />
      <Stack.Screen
        name="MyGrading"
        component={MyGradingScreen}
        options={({ route }) => ({ title: route.params?.name ? t('navigation.app.childGrading', { name: route.params.name }) : t('navigation.app.myGrading') })}
      />
      <Stack.Screen name="GradingHistory" component={GradingHistoryScreen} options={({ route }) => ({ title: route.params.title })} />
      <Stack.Screen name="CoachDashboard" component={CoachDashboardScreen} options={{ title: t('navigation.app.coach') }} />
      <Stack.Screen name="GradingBoard" component={GradingBoardScreen} options={({ route }) => ({ title: t('navigation.app.gradingBoard', { name: route.params.name }) })} />
      <Stack.Screen name="CoachStudent" component={CoachStudentScreen} options={({ route }) => ({ title: route.params.name })} />
    </Stack.Navigator>
  );
}
