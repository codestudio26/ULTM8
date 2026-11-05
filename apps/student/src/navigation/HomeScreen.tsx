import React, { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, Screen } from '../components/ui';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { LegalFooter } from '../components/LegalFooter';
import { useAuth, useCoachSchoolId, useEnrolledSchoolIds, useIsGuardian } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { useMyMinors } from '../guardians/guardianQueries';
import { HomeFeeCards, type FeePerson } from '../grading/HomeFeeCards';
import { SignUpInvites } from '../academies/SignUpInvites';
import { ChildInvites } from '../academies/ChildInvites';
import { PackRechargeCards } from '../memberships/PackRechargeCards';
import { anySchoolShowsPaymentHistory, useMemberAppSettings } from '../lib/memberAppQueries';
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
  const showPaymentHistory = anySchoolShowsPaymentHistory(useMemberAppSettings().data);
  const { logout, claims, pendingSchoolPick, clearPendingSchoolPick } = useAuth();
  const isGuardian = useIsGuardian();
  const isCoach = !!useCoachSchoolId();
  const enrolledSchoolIds = useEnrolledSchoolIds();
  const isStudent = enrolledSchoolIds.length > 0;
  // Student portal review SP1 (Decision 427): the School picked on first launch
  // is offered as a card, never forced. Anyone already working there (owner,
  // coach, staff) or enrolled there is never asked.
  const pickToOffer =
    pendingSchoolPick &&
    !enrolledSchoolIds.includes(pendingSchoolPick.id) &&
    !(claims?.grants ?? []).some((g) => g.schoolId === pendingSchoolPick.id)
      ? pendingSchoolPick
      : null;
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
    <ScrollView>
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 20 }}>{t('home.title')}</Text>
      {pickToOffer ? (
        <View
          accessibilityLabel={t('home.joinPick.title', { school: pickToOffer.name })}
          style={{ marginBottom: spacing[4], backgroundColor: theme.surface1, borderRadius: radius.button, padding: spacing[4] }}
        >
          <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
            {t('home.joinPick.title', { school: pickToOffer.name })}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>{t('home.joinPick.body')}</Text>
          <Button title={t('home.joinPick.join')} onPress={() => navigation.navigate('JoinSchool', { academyId: pickToOffer.id, name: pickToOffer.name })} />
          <Button title={t('home.joinPick.notNow')} variant="secondary" onPress={clearPendingSchoolPick} />
        </View>
      ) : null}
      {/* Decision 392: a School approved a sign-up made at its front desk. */}
      <SignUpInvites />
      <ChildInvites />
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
      <Button title={t('home.changePasscode')} variant="secondary" onPress={() => navigation.navigate('ChangePasscode')} />
      <Button title={t('home.browseAcademies')} onPress={() => navigation.navigate('Academies')} />
      <Button title={t('home.checkIn')} onPress={() => navigation.navigate('QrCheckIn')} />
      {isStudent ? <Button title={t('home.myGrading')} onPress={() => navigation.navigate('MyGrading')} /> : null}
      {isStudent ? <Button title={t('home.schoolNotes')} variant="secondary" onPress={() => navigation.navigate('SchoolNotes')} /> : null}
      <Button title={t('home.myBookings')} onPress={() => navigation.navigate('MyBookings')} />
      <Button title={t('home.myMemberships')} onPress={() => navigation.navigate('MyMemberships')} />
      {/* Decision 318 item 7: hidden when every one of the member's Schools hides payment history. */}
      {showPaymentHistory ? <Button title={t('home.paymentHistory')} variant="secondary" onPress={() => navigation.navigate('TransactionHistory')} /> : null}
      {isStudent ? <Button title={t('charges.home')} variant="secondary" onPress={() => navigation.navigate('MyCharges')} /> : null}
      <Button title={t('home.waivers')} onPress={() => navigation.navigate('Waivers')} />
      {isStudent ? <Button title={t('home.paymentMethods')} onPress={() => navigation.navigate('PaymentMethods')} /> : null}
      {isStudent ? <Button title={t('home.lessons')} onPress={() => navigation.navigate('Lessons')} /> : null}
      <Button title={t('home.notifications')} onPress={() => navigation.navigate('Notifications')} />
      {/* Decision 427 (SP2): any adult can add a child here; Kid Mode and the review list follow once they have one. */}
      <Button title={t('home.myMinors')} onPress={() => navigation.navigate('MyMinors')} />
      {isGuardian ? <Button title={t('home.kidMode')} onPress={() => navigation.navigate('KidModePin')} /> : null}
      {isGuardian ? (
        <Button title={t('home.needsReview')} variant="secondary" onPress={() => navigation.navigate('PendingReview')} />
      ) : null}
      <Button title={t('home.logOut')} variant="secondary" onPress={() => logout()} />
      <LegalFooter />
    </Screen>
    </ScrollView>
  );
}
