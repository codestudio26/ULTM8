import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useAuth } from '../auth/AuthContext';
import { ClassBookingRow } from '../bookings/ClassBookingRow';
import { MembershipPlanRow } from '../memberships/MembershipPlanRow';
import { rememberPlanNames } from '../memberships/planNameCache';
import { MyRankSection } from '../ranks/MyRankSection';
import { useDisciplines, useStudentRanks } from '../ranks/rankQueries';
import { useAcademy, useAcademyTimetable } from './academyQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'AcademyDetail'>;

const WEEKDAY_LABEL: Record<string, string> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
  SUNDAY: 'Sun',
};

export function AcademyDetailScreen({ route }: Props) {
  const { academyId } = route.params;
  const { claims } = useAuth();
  const { data: academy, isLoading, isError, error } = useAcademy(academyId);
  const { data: timetable } = useAcademyTimetable(academyId);
  // Fetched here, in parallel with academy/timetable above, rather than inside
  // MyRankSection itself — found on review: firing them only once MyRankSection
  // mounts (i.e. after the isLoading early-return below) meant they never started
  // until `useAcademy` had already resolved, even though this data needs nothing
  // from `academy` (only academyId/studentId, both available synchronously here).
  const studentRanks = useStudentRanks(claims?.sub ?? null, academyId);
  const disciplines = useDisciplines(academyId);
  const slots = timetable?.pages.flatMap((p) => p.items) ?? [];

  // Opportunistic cache for MyMembershipsScreen's own "resolve a raw membershipPlanId
  // to a title" problem (see planNameCache.ts) — every plan a Student ever browses
  // here becomes resolvable there, at zero extra network cost.
  useEffect(() => {
    if (academy?.membershipPlans.length) {
      rememberPlanNames(academy.membershipPlans);
    }
  }, [academy?.membershipPlans]);

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (isError || !academy) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load this academy — please try again.')} />
      </Screen>
    );
  }

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>{academy.name}</Text>
        {academy.address ? <Text style={{ color: '#5F6368', marginTop: 4 }}>{academy.address}</Text> : null}
        {academy.description ? <Text style={{ marginTop: 12 }}>{academy.description}</Text> : null}

        {academy.activities.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Activities</Text>
            <Text style={{ color: '#5F6368' }}>{academy.activities.join(' · ')}</Text>
          </View>
        ) : null}

        {academy.membershipPlans.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Membership Plans</Text>
            {academy.membershipPlans.map((plan) => (
              <MembershipPlanRow key={plan.id} plan={plan} />
            ))}
          </View>
        ) : null}

        <MyRankSection studentRanks={studentRanks} disciplines={disciplines} />

        {academy.upcomingClasses.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Upcoming classes</Text>
            {academy.upcomingClasses.map((c) => (
              <ClassBookingRow key={c.id} classItem={c} />
            ))}
          </View>
        ) : null}

        {slots.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Timetable</Text>
            {slots.map((slot) => (
              <View key={slot.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
                <Text>
                  {WEEKDAY_LABEL[slot.weekday] ?? slot.weekday} · {slot.startTime}–{slot.endTime}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </Screen>
    </ScrollView>
  );
}
