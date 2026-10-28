import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type components } from '@ultm8/api-client';
import { Button, ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateTime } from '../lib/formatDate';
import { useT } from '../i18n/I18nProvider';
import { useAcademy } from '../academies/academyQueries';
import { BookingGuests } from '../bookings/BookingGuests';
import { ClassBookingRow } from '../bookings/ClassBookingRow';
import { useCancelBooking, useMinorBookings, useMinorSchools } from '../bookings/bookingQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'ChildBooking'>;
type MinorBooking = components['schemas']['MinorBookingDto'];

/**
 * Decision 379 — a parent books a class for their child: pick one of the
 * child's Schools, book a class (with guests paid for by the child's own
 * Friend Passes, Waivers Q9), share each guest's signing link, and see and
 * cancel the child's upcoming bookings. Kid Mode stays without guests.
 */
export function ChildBookingScreen({ route }: Props) {
  const { studentId, name } = route.params;
  const t = useT();
  const schools = useMinorSchools(studentId);
  const bookings = useMinorBookings(studentId);
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

  const upcoming = bookings.data?.items ?? [];

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('guardians.childBooking.upcomingTitle')}</Text>
        {bookings.isLoading ? <ActivityIndicator /> : null}
        {bookings.isError && !bookings.data ? <InlineError message={t('guardians.childBooking.bookingsLoadError')} /> : null}
        {bookings.data && upcoming.length === 0 ? (
          <Text style={{ color: '#5F6368', fontSize: 13 }}>{t('guardians.childBooking.noBookings', { name })}</Text>
        ) : null}
        {upcoming.map((b) => (
          <ChildBookingRow key={b.id} booking={b} studentId={studentId} />
        ))}

        <Text style={{ fontWeight: '600', marginTop: 20, marginBottom: 6 }}>{t('guardians.childBooking.bookTitle')}</Text>
        {schoolList.length === 0 ? (
          <Text style={{ color: '#5F6368', fontSize: 13 }}>{t('guardians.childBooking.noSchools', { name })}</Text>
        ) : null}
        {schoolList.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {schoolList.map((s) => (
              <Pressable
                key={s.schoolId}
                onPress={() => setPickedSchoolId(s.schoolId)}
                accessibilityRole="button"
                accessibilityState={{ selected: s.schoolId === schoolId }}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: s.schoolId === schoolId ? '#1A73E8' : '#DADCE0',
                  backgroundColor: s.schoolId === schoolId ? '#E8F0FE' : 'transparent',
                }}
              >
                <Text>{s.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : schoolList.length === 1 ? (
          <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 6 }}>{schoolList[0]!.name}</Text>
        ) : null}

        {schoolId && academy.isLoading ? <ActivityIndicator /> : null}
        {schoolId && academy.isError && !academy.data ? (
          <InlineError message={getApiErrorMessage(academy.error, t('guardians.childBooking.classesLoadError'))} />
        ) : null}
        {academy.data && academy.data.upcomingClasses.length === 0 ? (
          <Text style={{ color: '#5F6368', fontSize: 13 }}>{t('guardians.childBooking.noClasses')}</Text>
        ) : null}
        {schoolId
          ? academy.data?.upcomingClasses.map((c) => <ClassBookingRow key={`${schoolId}-${c.id}`} classItem={c} schoolId={schoolId} studentId={studentId} />)
          : null}
      </Screen>
    </ScrollView>
  );
}

/** One of the child's upcoming bookings: the guests' links, and Cancel with an
 * inline confirm (Alert.alert does nothing on React Native Web; see MyBookingsScreen). */
function ChildBookingRow({ booking, studentId }: { booking: MinorBooking; studentId: string }) {
  const t = useT();
  const cancelBooking = useCancelBooking(studentId);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmCancel() {
    if (cancelBooking.isPending) return;
    setConfirming(false);
    setError(null);
    try {
      await cancelBooking.mutateAsync(booking.id);
    } catch (err) {
      setError(getApiErrorMessage(err, t('bookings.myBookings.cancelError')));
    }
  }

  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontWeight: '600' }}>{booking.classTitle}</Text>
      <Text style={{ color: '#5F6368', fontSize: 12 }}>{formatDateTime(booking.classStartsAt)}</Text>
      {booking.guestCount > 0 ? (
        <>
          <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('bookings.guests.count', { count: booking.guestCount })}</Text>
          <BookingGuests bookingId={booking.id} studentId={studentId} />
        </>
      ) : null}
      {error ? <InlineError message={error} /> : null}
      {confirming ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#C5221F', fontSize: 13 }}>{t('bookings.myBookings.cancelConfirm')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('bookings.myBookings.keepBooking')} variant="secondary" onPress={() => setConfirming(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('bookings.myBookings.cancelBooking')} variant="destructive" onPress={confirmCancel} loading={cancelBooking.isPending} />
            </View>
          </View>
        </View>
      ) : (
        <Button title={t('bookings.myBookings.cancel')} variant="secondary" onPress={() => setConfirming(true)} loading={cancelBooking.isPending} />
      )}
    </View>
  );
}
