import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useAuth, useEnrolledSchoolIds, useIsGuardian } from '../auth/AuthContext';
import { ClassBookingRow } from '../bookings/ClassBookingRow';
import { MembershipPlanRow } from '../memberships/MembershipPlanRow';
import { rememberPlanNames } from '../memberships/planNameCache';
import { MyRankSection } from '../ranks/MyRankSection';
import { useDisciplines, useStudentRanks } from '../ranks/rankQueries';
import { useAcademy, useAcademyTimetable } from './academyQueries';
import { useDeclareOptions } from './joinQueries';
import type { TranslationKey } from '../i18n/types';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'AcademyDetail'>;

const WEEKDAY_LABEL: Record<string, TranslationKey> = {
  MONDAY: 'academies.weekday.MONDAY',
  TUESDAY: 'academies.weekday.TUESDAY',
  WEDNESDAY: 'academies.weekday.WEDNESDAY',
  THURSDAY: 'academies.weekday.THURSDAY',
  FRIDAY: 'academies.weekday.FRIDAY',
  SATURDAY: 'academies.weekday.SATURDAY',
  SUNDAY: 'academies.weekday.SUNDAY',
};

export function AcademyDetailScreen({ route, navigation }: Props) {
  const t = useT();
  const { academyId } = route.params;
  const { claims } = useAuth();
  const enrolled = useEnrolledSchoolIds().includes(academyId);
  const isGuardian = useIsGuardian();
  // A student who joined without adding a belt can add one later (Decision 137).
  const beltOptions = useDeclareOptions(enrolled ? claims?.sub ?? null : null, academyId);
  const canAddBelt = (beltOptions.data?.items.length ?? 0) > 0;
  const { data: academy, isLoading, error } = useAcademy(academyId);
  // FOUND ON REVIEW: `data` was destructured on its own, with fetchNextPage/
  // hasNextPage never wired to anything — only the timetable's first page (the
  // server's default page size) could ever render, silently, for any School whose
  // weekly timetable has more slots than that. This screen is a ScrollView holding
  // several sections (Activities/Plans/Rank/Classes/Timetable), not a single
  // PaginatedListScreen-style FlatList, so pagination here is a "Load more" tap
  // rather than infinite scroll.
  const {
    data: timetable,
    fetchNextPage: fetchNextTimetablePage,
    hasNextPage: hasMoreTimetableSlots,
    isFetchingNextPage: isFetchingMoreTimetableSlots,
  } = useAcademyTimetable(academyId);
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

  // FOUND ON REVIEW: checking `isError` unconditionally replaced an
  // already-loaded academy (activities, plans, timetable, everything below)
  // with a full-screen error the moment any background refetch failed —
  // including the "no connection" case this app's offline caching exists to
  // handle gracefully. Only block on the error when there's truly nothing to
  // show, matching PaginatedListScreen's own "data takes precedence"
  // discipline (its own isError gate is `&& items.length === 0`, not bare).
  if (!academy) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, t('academies.detail.loadFailed'))} />
      </Screen>
    );
  }

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>{academy.name}</Text>
        {academy.address ? <Text style={{ color: '#5F6368', marginTop: 4 }}>{academy.address}</Text> : null}
        {academy.description ? <Text style={{ marginTop: 12 }}>{academy.description}</Text> : null}

        {!enrolled || isGuardian ? (
          <View style={{ marginTop: 16 }}>
            <Button title={t('academies.detail.join')} onPress={() => navigation.navigate('JoinSchool', { academyId, name: academy.name })} />
          </View>
        ) : null}
        {canAddBelt && claims ? (
          <View style={{ marginTop: 8 }}>
            <Button
              title={t('academies.detail.addMyBelt')}
              variant="secondary"
              onPress={() => navigation.navigate('JoinSchool', { academyId, name: academy.name, beltsFor: { studentId: claims.sub, name: t('academies.join.me') } })}
            />
          </View>
        ) : null}

        {academy.activities.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('academies.detail.activities')}</Text>
            <Text style={{ color: '#5F6368' }}>{academy.activities.join(' · ')}</Text>
          </View>
        ) : null}

        {academy.membershipPlans.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('academies.detail.membershipPlans')}</Text>
            {academy.membershipPlans.map((plan) => (
              <MembershipPlanRow key={plan.id} plan={plan} schoolId={academyId} />
            ))}
          </View>
        ) : null}

        <MyRankSection studentRanks={studentRanks} disciplines={disciplines} />

        {academy.upcomingClasses.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('academies.detail.upcomingClasses')}</Text>
            {academy.upcomingClasses.map((c) => (
              <ClassBookingRow key={c.id} classItem={c} />
            ))}
          </View>
        ) : null}

        {slots.length ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('academies.detail.timetable')}</Text>
            {slots.map((slot) => (
              <View key={slot.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
                <Text>
                  {t('academies.detail.slot', {
                    weekday: WEEKDAY_LABEL[slot.weekday] ? t(WEEKDAY_LABEL[slot.weekday]!) : slot.weekday,
                    start: slot.startTime,
                    end: slot.endTime,
                  })}
                </Text>
              </View>
            ))}
            {hasMoreTimetableSlots ? (
              <View style={{ marginTop: 8 }}>
                <Button
                  title={t('academies.detail.loadMore')}
                  variant="secondary"
                  loading={isFetchingMoreTimetableSlots}
                  onPress={() => fetchNextTimetablePage()}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </Screen>
    </ScrollView>
  );
}
