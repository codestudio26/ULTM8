import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { ClassBookingRow } from '../bookings/ClassBookingRow';
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
  const { data: academy, isLoading, isError, error } = useAcademy(academyId);
  const { data: timetable } = useAcademyTimetable(academyId);
  const slots = timetable?.pages.flatMap((p) => p.items) ?? [];

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
