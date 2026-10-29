import React, { useMemo } from 'react';
import { Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { LegalFooter } from '../components/LegalFooter';
import { useAuth, useCoachSchoolId, useEnrolledSchoolIds, useIsGuardian } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { useMyMinors } from '../guardians/guardianQueries';
import { HomeFeeCards, type FeePerson } from '../grading/HomeFeeCards';
import { SignUpInvites } from '../academies/SignUpInvites';
import { PackRechargeCards } from '../memberships/PackRechargeCards';
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
  const t = useT();
  const { logout, claims } = useAuth();
  const isGuardian = useIsGuardian();
  const isCoach = !!useCoachSchoolId();
  const isStudent = useEnrolledSchoolIds().length > 0;
  const minors = useMyMinors(isGuardian);
  // Promotion fees to answer: the student's own, and each of a guardian's children's.
  const feePeople = useMemo<FeePerson[]>(
    () => [
      ...(isStudent && claims?.sub ? [{ studentId: claims.sub, childName: null }] : []),
      ...(isGuardian ? (minors.data?.items ?? []).map((m) => ({ studentId: m.studentId, childName: m.firstName })) : []),
    ],
    [isStudent, isGuardian, claims?.sub, minors.data],
  );

  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 20 }}>{t('home.title')}</Text>
      {/* Decision 392: a School approved a sign-up made at its front desk. */}
      <SignUpInvites />
      {/* Decision 393: a Class Pack ran out at the desk. */}
      <PackRechargeCards />
      <HomeFeeCards
        people={feePeople}
        onAnswer={(person, request) =>
          navigation.navigate(
            'MyGrading',
            person.childName ? { studentId: person.studentId, name: person.childName, openFeeId: request.id } : { openFeeId: request.id },
          )
        }
      />
      {isCoach ? <Button title={t('home.coachDashboard')} onPress={() => navigation.navigate('CoachDashboard')} /> : null}
      <Button title={t('home.myProfile')} variant="secondary" onPress={() => navigation.navigate('Profile')} />
      <Button title={t('home.browseAcademies')} onPress={() => navigation.navigate('Academies')} />
      <Button title={t('home.checkIn')} onPress={() => navigation.navigate('QrCheckIn')} />
      {isStudent ? <Button title={t('home.myGrading')} onPress={() => navigation.navigate('MyGrading')} /> : null}
      <Button title={t('home.myBookings')} onPress={() => navigation.navigate('MyBookings')} />
      <Button title={t('home.myMemberships')} onPress={() => navigation.navigate('MyMemberships')} />
      <Button title={t('home.paymentHistory')} variant="secondary" onPress={() => navigation.navigate('TransactionHistory')} />
      <Button title={t('home.waivers')} onPress={() => navigation.navigate('Waivers')} />
      {isStudent ? <Button title={t('home.paymentMethods')} onPress={() => navigation.navigate('PaymentMethods')} /> : null}
      {isStudent ? <Button title={t('home.lessons')} onPress={() => navigation.navigate('Lessons')} /> : null}
      <Button title={t('home.notifications')} onPress={() => navigation.navigate('Notifications')} />
      {isGuardian ? <Button title={t('home.myMinors')} onPress={() => navigation.navigate('MyMinors')} /> : null}
      {isGuardian ? <Button title={t('home.kidMode')} onPress={() => navigation.navigate('KidModePin')} /> : null}
      {isGuardian ? (
        <Button title={t('home.needsReview')} variant="secondary" onPress={() => navigation.navigate('PendingReview')} />
      ) : null}
      <Button title={t('home.logOut')} variant="secondary" onPress={() => logout()} />
      <LegalFooter />
    </Screen>
  );
}
