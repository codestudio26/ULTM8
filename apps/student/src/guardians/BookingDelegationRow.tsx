import React from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useGrantBookingDelegation, useWithdrawBookingDelegation } from './bookingDelegationQueries';

type BookingDelegation = components['schemas']['BookingDelegationResponseDto'];

/** Decision 123 — Guardian "Kid Mode" booking delegation. Same per-minor,
 * revocable-toggle shape as ConsentTierRow, deliberately simpler (one
 * capability, not two tiers, so no confirm-before-withdraw step — unlike
 * BASELINE consent, withdrawing this never deactivates the minor's account or
 * touches any other data; it only stops Kid Mode booking, and existing
 * Kid-Mode bookings move to the Guardian's own review queue rather than
 * disappearing). */
export function BookingDelegationRow({ studentId, delegation }: { studentId: string; delegation: BookingDelegation | undefined }) {
  const grant = useGrantBookingDelegation();
  const withdraw = useWithdrawBookingDelegation();

  // Same "derive from the mutation's own result, don't wait on a round-tripped
  // prop" + "reset the opposing mutation" discipline ConsentTierRow already
  // established (its own header comment explains why both are needed).
  const active = withdraw.isSuccess ? undefined : (delegation ?? grant.data);

  function handleGrant() {
    if (grant.isPending) return;
    withdraw.reset();
    grant.mutate(studentId);
  }

  function handleWithdraw() {
    if (!active || withdraw.isPending) return;
    grant.reset();
    withdraw.mutate(active.id);
  }

  return (
    <View style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontWeight: '600' }}>Kid Mode — self-booking</Text>
      <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>
        Lets your minor book a class themselves, from your device, against a class credit you've already paid for — never a
        purchase, cancellation, or waiver signature.
      </Text>

      {grant.isError ? (
        <InlineError message={getApiErrorMessage(grant.error, 'Could not enable Kid Mode — please try again.')} />
      ) : null}
      {withdraw.isError ? (
        <InlineError message={getApiErrorMessage(withdraw.error, 'Could not disable Kid Mode — please try again.')} />
      ) : null}

      {active ? (
        <>
          <Text style={{ color: '#188038', fontSize: 13, marginTop: 6 }}>Enabled ✓</Text>
          <Button title="Disable Kid Mode" variant="secondary" onPress={handleWithdraw} loading={withdraw.isPending} />
        </>
      ) : (
        <Button title="Enable Kid Mode" onPress={handleGrant} loading={grant.isPending} />
      )}
    </View>
  );
}
