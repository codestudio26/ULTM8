import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useAcademy } from '../academies/academyQueries';
import { useMinorSchools } from '../bookings/bookingQueries';
import { MembershipPlanRow } from '../memberships/MembershipPlanRow';
import { usePlanAvailability } from '../memberships/planWaitlistQueries';
import { ChildSchoolPicker } from './ChildSchoolPicker';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'ChildPlans'>;

/** Decision 428 (Student portal review M2) — a parent buys a plan for their
 * child at one of the child's Schools. Payment is a new card (Stripe Checkout)
 * or the School's cash/bank option; a saved card is the parent's own, so the
 * API doesn't take it for a child (MembershipPlanRow hides it). */
export function ChildPlansScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const t = useT();
  const schools = useMinorSchools(studentId);
  const [pickedSchoolId, setPickedSchoolId] = useState<string | null>(null);
  const schoolList = schools.data?.items ?? [];
  const schoolId = pickedSchoolId ?? schoolList[0]?.schoolId ?? null;
  const academy = useAcademy(schoolId);

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
  if (schoolList.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>{t('guardians.childBooking.noSchools', { name })}</Text>
      </Screen>
    );
  }

  const plans = academy.data?.membershipPlans ?? [];
  // Decision 435 item 14: a parent sees their child's place on a full plan's waiting list.
  const availability = usePlanAvailability(schoolId ?? null, studentId);

  return (
    <ScrollView>
      <Screen>
        <ChildSchoolPicker schools={schoolList} selectedId={schoolId} onSelect={setPickedSchoolId} />
        <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 8 }}>{t('guardians.childPlans.intro', { name })}</Text>
        {academy.isLoading ? <ActivityIndicator /> : null}
        {academy.isError && !academy.data ? (
          <InlineError message={getApiErrorMessage(academy.error, t('guardians.childPlans.loadError'))} />
        ) : null}
        {academy.data && plans.length === 0 ? (
          <Text style={{ color: '#5F6368', fontSize: 13 }}>{t('guardians.childPlans.empty')}</Text>
        ) : null}
        {schoolId ? plans.map((plan) => (
              <MembershipPlanRow
                key={`${schoolId}-${plan.id}`}
                plan={plan}
                schoolId={schoolId}
                forStudentId={studentId}
                availability={availability.data?.items.find((a) => a.planId === plan.id)}
              />
            )) : null}
      </Screen>
    </ScrollView>
  );
}
