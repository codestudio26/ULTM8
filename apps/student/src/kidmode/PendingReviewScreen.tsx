import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
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
  const t = useT();
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
        <ErrorBanner message={getApiErrorMessage(review.error, t('kidmode.pendingReview.loadError'))} />
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
      setActionError(getApiErrorMessage(err, t('kidmode.pendingReview.confirmError')));
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
      setActionError(getApiErrorMessage(err, t('kidmode.pendingReview.cancelError')));
    } finally {
      setActingOnId(null);
    }
  }

  if (items.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>{t('kidmode.pendingReview.empty')}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 12 }}>{t('kidmode.pendingReview.intro')}</Text>
      {actionError ? <InlineError message={actionError} /> : null}
      {items.map((booking) => (
        <View key={booking.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
          <Text style={{ fontWeight: '600' }}>{nameByStudentId.get(booking.studentId) ?? t('kidmode.pendingReview.linkedMinor')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t('kidmode.pendingReview.confirm')}
                onPress={() => handleConfirm(booking.id, booking.studentId)}
                loading={actingOnId === booking.id && confirm.isPending}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={t('kidmode.pendingReview.cancel')}
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
