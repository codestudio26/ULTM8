import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { type components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useCancelBooking, useMyBookings } from './bookingQueries';

type Booking = components['schemas']['BookingResponseDto'];

/** Cancel is only offered for status UPCOMING (BookingStatus enum:
 * UPCOMING/COMPLETED/CANCELLED/NO_SHOW, apps/api/prisma/schema.prisma) — the other
 * three are already-resolved terminal states with nothing to cancel. */
function BookingRow({ booking }: { booking: Booking }) {
  const cancelBooking = useCancelBooking();
  const [error, setError] = useState<string | null>(null);
  // FOUND ON REVIEW (same class of bug as ConsentTierRow's withdraw confirmation):
  // Alert.alert is a documented no-op on React Native Web, this app's own
  // interactive-test target, so this confirmation never actually appeared there —
  // "Cancel" silently did nothing on web. Replaced with an inline panel (plain
  // Views/Text, no native dialog API) that renders identically on every platform.
  const [confirming, setConfirming] = useState(false);

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
      setError(getApiErrorMessage(err, 'Could not cancel this booking — please try again.'));
    }
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>Class {booking.classId}</Text>
      <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>Status: {booking.status}</Text>
      {error ? <InlineError message={error} /> : null}

      {booking.status === 'UPCOMING' && confirming ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#C5221F', fontSize: 13 }}>Cancel booking? This cannot be undone.</Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Keep booking" variant="secondary" onPress={keepBooking} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Cancel booking"
                variant="destructive"
                onPress={confirmCancel}
                loading={cancelBooking.isPending}
              />
            </View>
          </View>
        </View>
      ) : booking.status === 'UPCOMING' ? (
        <Button title="Cancel" variant="secondary" onPress={openConfirm} loading={cancelBooking.isPending} />
      ) : null}
    </View>
  );
}

export function MyBookingsScreen() {
  const query = useMyBookings();

  return (
    <PaginatedListScreen
      query={query}
      renderItem={(item: Booking) => <BookingRow booking={item} />}
      emptyMessage="No bookings yet."
      errorFallbackMessage="Failed to load bookings — please try again."
    />
  );
}
