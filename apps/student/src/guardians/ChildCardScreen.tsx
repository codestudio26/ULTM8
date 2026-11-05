import React from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useMinorSchools } from '../bookings/bookingQueries';
import { useChildMembershipCards, type MembershipCard } from '../attendance/attendanceQueries';
import { MembershipCards } from '../attendance/MembershipCards';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'ChildCard'>;

/** Decision 398 ("not built yet: a Guardian's view of their child's card in
 * the app") — a parent sees their child's membership card at each of the
 * child's Schools: the same card the child sees under their own QR (School,
 * photo, name, personal check-in code, memberships in effect now). There is
 * no QR here: the live QR is the child's own and only shows on their device. */
export function ChildCardScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const t = useT();
  const schools = useMinorSchools(studentId);
  const schoolIds = (schools.data?.items ?? []).map((s) => s.schoolId);
  const cards = useChildMembershipCards(studentId, schoolIds);

  if (schools.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (schools.isError && !schools.data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(schools.error, t('guardians.childBooking.loadError'))} />
      </Screen>
    );
  }
  if (schoolIds.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>{t('guardians.childBooking.noSchools', { name })}</Text>
      </Screen>
    );
  }

  const loaded = cards.map((c) => c.data).filter((c): c is MembershipCard => !!c);
  const failed = cards.find((c) => c.isError);
  return (
    <ScrollView>
      <Screen>
        <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 8 }}>{t('guardians.childCard.intro', { name })}</Text>
        {cards.some((c) => c.isLoading) ? <ActivityIndicator /> : null}
        {failed ? <InlineError message={getApiErrorMessage(failed.error, t('guardians.childCard.loadError'))} /> : null}
        <MembershipCards cards={loaded} />
      </Screen>
    </ScrollView>
  );
}
