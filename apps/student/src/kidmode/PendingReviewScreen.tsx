import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useMyMinors } from '../guardians/guardianQueries';
import {
  useCancelPendingReviewBooking,
  useConfirmPendingReviewBooking,
  usePendingReviewBookings,
} from '../guardians/bookingDelegationQueries';

/** Decision 123 — surfaced after withdrawing a minor's Kid-Mode delegation: any
 * Booking they made under it neither stayed nor auto-cancelled, it landed here
 * for an explicit Confirm (keep it) or Cancel (release the credit, via the
 * existing Guardian-on-behalf-of PATCH /bookings/{id}/cancel path — no new
 * cancellation logic). */
export function PendingReviewScreen() {
  const review = usePendingReviewBookings();
  const minors = useMyMinors();
  const confirm = useConfirmPendingReviewBooking();
  const cancel = useCancelPendingReviewBooking();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  if (review.isLoading || minors.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (review.isError && !review.data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(review.error, 'Could not load your review queue — please try again.')} />
      </Screen>
    );
  }

  const nameByStudentId = new Map((minors.data?.items ?? []).map((m) => [m.studentId, `${m.firstName} ${m.surname}`]));
  const items = review.data?.items ?? [];

  async function handleConfirm(bookingId: string, studentId: string) {
    if (actingOnId) return;
    setActionError(null);
    setActingOnId(bookingId);
    try {
      await confirm.mutateAsync({ bookingId, studentId });
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not confirm this booking — please try again.'));
    } finally {
      setActingOnId(null);
    }
  }

  async function handleCancel(bookingId: string, studentId: string) {
    if (actingOnId) return;
    setActionError(null);
    setActingOnId(bookingId);
    try {
      await cancel.mutateAsync({ bookingId, studentId });
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not cancel this booking — please try again.'));
    } finally {
      setActingOnId(null);
    }
  }

  if (items.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>Nothing needs your review right now.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 12 }}>
        These were booked under Kid Mode before it was disabled. Confirm to keep them, or cancel to release the credit.
      </Text>
      {actionError ? <InlineError message={actionError} /> : null}
      {items.map((booking) => (
        <View key={booking.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
          <Text style={{ fontWeight: '600' }}>{nameByStudentId.get(booking.studentId) ?? 'Linked minor'}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Confirm"
                onPress={() => handleConfirm(booking.id, booking.studentId)}
                loading={actingOnId === booking.id && confirm.isPending}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Cancel"
                variant="destructive"
                onPress={() => handleCancel(booking.id, booking.studentId)}
                loading={actingOnId === booking.id && cancel.isPending}
              />
            </View>
          </View>
        </View>
      ))}
    </Screen>
  );
}
