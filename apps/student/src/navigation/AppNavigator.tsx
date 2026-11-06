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
import { LegalDocumentScreen } from '../legal/LegalDocumentScreen';
import { LEGAL_PAGES } from '../legal/legalPages';
import { ChildBookingScreen } from '../guardians/ChildBookingScreen';
import { MyMinorsScreen } from '../guardians/MyMinorsScreen';
import { ChildWaiversScreen } from '../guardians/ChildWaiversScreen';
import { ChildPlansScreen } from '../guardians/ChildPlansScreen';
import { ChildCardScreen } from '../guardians/ChildCardScreen';
import { ChangePasscodeScreen } from '../auth/ChangePasscodeScreen';
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
import { useCoachSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

/** Coaches (Instructors and Branch Staff) land on their dashboard; everyone
 * else on the student home (Decision 184 item 4). Student portal review SP1
 * (Decision 427): the School picked on first launch (Decision 266) is no
 * longer forced as the first screen. That left parents, coaches and owners
 * on a Join screen with no Home under it, so Back, "Done" and "Not now" went
 * nowhere. Home now offers the pick as a card (HomeScreen), with Home always
 * underneath JoinSchool. */
export function AppNavigator() {
  const t = useT();
  const coachSchoolId = useCoachSchoolId();
  const initialRouteName = coachSchoolId ? 'CoachDashboard' : 'Home';

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
      <Stack.Screen
        name="ChildWaivers"
        component={ChildWaiversScreen}
        options={({ route }) => ({ title: t('guardians.childWaivers.title', { name: route.params.name }) })}
      />
      <Stack.Screen
        name="ChildPlans"
        component={ChildPlansScreen}
        options={({ route }) => ({ title: t('guardians.childPlans.title', { name: route.params.name }) })}
      />
      <Stack.Screen
        name="ChildCard"
        component={ChildCardScreen}
        options={({ route }) => ({ title: t('guardians.childCard.title', { name: route.params.name }) })}
      />
      <Stack.Screen name="ChangePasscode" component={ChangePasscodeScreen} options={{ title: t('auth.changePasscode.title') }} />
      <Stack.Screen name="KidModePin" component={KidModePinScreen} options={{ title: t('navigation.app.kidMode') }} />
      <Stack.Screen
        name="KidModeBooking"
        component={KidModeBookingScreen}
        options={{ title: t('navigation.app.kidMode'), headerBackVisible: false, gestureEnabled: false }}
      />
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
      <Stack.Screen name="LegalDocument" component={LegalDocumentScreen} options={({ route }) => ({ title: t(LEGAL_PAGES[route.params.slug]) })} />
    </Stack.Navigator>
  );
}
