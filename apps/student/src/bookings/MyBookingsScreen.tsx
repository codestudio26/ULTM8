import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { type components } from '@ultm8/api-client';
import { Button, InlineError, TextField } from '../components/ui';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useEnterCheckInCode } from '../attendance/attendanceQueries';
import { useCancelBooking, useMyBookings } from './bookingQueries';
import { BookingGuests } from './BookingGuests';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

const BOOKING_STATUS: Record<string, TranslationKey> = {
  UPCOMING: 'bookings.statusLabel.upcoming',
  COMPLETED: 'bookings.statusLabel.completed',
  CANCELLED: 'bookings.statusLabel.cancelled',
  NO_SHOW: 'bookings.statusLabel.noShow',
};

type Booking = components['schemas']['BookingResponseDto'];

/** Cancel is only offered for status UPCOMING (BookingStatus enum:
 * UPCOMING/COMPLETED/CANCELLED/NO_SHOW, apps/api/prisma/schema.prisma) — the other
 * three are already-resolved terminal states with nothing to cancel. */
function BookingRow({ booking }: { booking: Booking }) {
  const t = useT();
  const cancelBooking = useCancelBooking();
  const enterCode = useEnterCheckInCode();
  const [error, setError] = useState<string | null>(null);
  // FOUND ON REVIEW (same class of bug as ConsentTierRow's withdraw confirmation):
  // Alert.alert is a documented no-op on React Native Web, this app's own
  // interactive-test target, so this confirmation never actually appeared there —
  // "Cancel" silently did nothing on web. Replaced with an inline panel (plain
  // Views/Text, no native dialog API) that renders identically on every platform.
  const [confirming, setConfirming] = useState(false);
  // Decision 235 — camera-free check-in: an inline code-entry panel, same
  // reasoning as the cancel-confirm panel above (no native dialog/camera API
  // either way renders on web).
  const [enteringCode, setEnteringCode] = useState(false);
  const [code, setCode] = useState('');

  function openConfirm() {
    if (cancelBooking.isPending) return;
    setConfirming(true);
  }

  function keepBooking() {
    setConfirming(false);
  }

  async function confirmCancel() {
    // Re-entrancy guard against a double-fired destructive-button tap (a known
    // touch-event case on Android) sending two overlapping cancel requests.
    if (cancelBooking.isPending) return;
    setConfirming(false);
    setError(null);
    try {
      await cancelBooking.mutateAsync(booking.id);
    } catch (err) {
      setError(getApiErrorMessage(err, t('bookings.myBookings.cancelError')));
    }
  }

  function openCodeEntry() {
    if (enterCode.isPending) return;
    setError(null);
    setCode('');
    setEnteringCode(true);
  }

  function cancelCodeEntry() {
    setEnteringCode(false);
    setCode('');
  }

  async function submitCode() {
    if (enterCode.isPending) return;
    setError(null);
    try {
      await enterCode.mutateAsync({ classId: booking.classId, code });
      setEnteringCode(false);
      setCode('');
    } catch (err) {
      setError(getApiErrorMessage(err, t('bookings.myBookings.codeError')));
    }
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>{t('bookings.myBookings.classLabel', { classId: booking.classId })}</Text>
      <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>{t('bookings.myBookings.status', { status: BOOKING_STATUS[booking.status] ? t(BOOKING_STATUS[booking.status]) : booking.status })}</Text>
      {error ? <InlineError message={error} /> : null}
      {booking.status === 'UPCOMING' && booking.attendees.length > 0 ? <BookingGuests bookingId={booking.id} /> : null}

      {booking.status === 'UPCOMING' && confirming ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#C5221F', fontSize: 13 }}>{t('bookings.myBookings.cancelConfirm')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('bookings.myBookings.keepBooking')} variant="secondary" onPress={keepBooking} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('bookings.myBookings.cancelBooking')}
                variant="destructive"
                onPress={confirmCancel}
                loading={cancelBooking.isPending}
              />
            </View>
          </View>
        </View>
      ) : booking.status === 'UPCOMING' && enteringCode ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 13, marginBottom: 6 }}>
            {t('bookings.myBookings.codeInstructions')}
          </Text>
          <TextField
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('bookings.myBookings.cancel')} variant="secondary" onPress={cancelCodeEntry} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('bookings.myBookings.checkIn')}
                onPress={submitCode}
                loading={enterCode.isPending}
                disabled={code.length !== 6}
              />
            </View>
          </View>
        </View>
      ) : booking.status === 'UPCOMING' ? (
        <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title={t('bookings.myBookings.checkInWithCode')} variant="secondary" onPress={openCodeEntry} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={t('bookings.myBookings.cancel')} variant="secondary" onPress={openConfirm} loading={cancelBooking.isPending} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function MyBookingsScreen() {
  const t = useT();
  const query = useMyBookings();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Booking) => <BookingRow booking={item} />}
      emptyMessage={t('bookings.myBookings.empty')}
      errorFallbackMessage={t('bookings.myBookings.loadError')}
    />
  );
}
