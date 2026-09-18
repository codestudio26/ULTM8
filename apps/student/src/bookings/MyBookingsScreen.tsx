import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
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

  function confirmCancel() {
    Alert.alert('Cancel booking?', 'This cannot be undone.', [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          // Re-entrancy guard against a double-fired destructive-button tap (a known
          // touch-event case on Android) sending two overlapping cancel requests.
          if (cancelBooking.isPending) return;
          setError(null);
          try {
            await cancelBooking.mutateAsync(booking.id);
          } catch (err) {
            setError(getApiErrorMessage(err, 'Could not cancel this booking — please try again.'));
          }
        },
      },
    ]);
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>Class {booking.classId}</Text>
      <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>Status: {booking.status}</Text>
      {error ? <InlineError message={error} /> : null}
      {booking.status === 'UPCOMING' ? (
        <Button title="Cancel" variant="secondary" onPress={confirmCancel} loading={cancelBooking.isPending} />
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
