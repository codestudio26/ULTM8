import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ApiError } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useBookClass } from './bookingQueries';
import { useJoinWaitlist, useWithdrawWaitlist } from './waitlistMutations';
import type { AppStackParamList } from '../navigation/types';

interface ClassSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

/** Substantive progress only — kept separate from `actionError` (below) so a failed
 * action never destroys state a prior action already established. Found on review:
 * the original version folded errors into this same union, which meant a transient
 * failure leaving the waitlist threw away the entry's id — and since there's no
 * GET /waitlist/me (see waitlistMutations.ts), that id can never be recovered,
 * stranding the Student on the waitlist with no in-app way off it. */
type RowState =
  | { kind: 'idle' }
  | { kind: 'booked' }
  | { kind: 'full' }
  | { kind: 'waitlisted'; entryId: string; position: number }
  | { kind: 'waiverRequired' };

/** Per-class booking action for AcademyDetailScreen's "Upcoming classes" list
 * (Slice 2). Three real, server-verified gates can reject a booking attempt
 * (apps/api/src/bookings/bookings.service.ts): an unsigned Waiver, rank
 * ineligibility, and a full Class — the unsigned-Waiver case now gets a real
 * "Sign waiver" deep-link to the Waivers screen (detected via the stable
 * WAIVER_REQUIRED error code, not text-matching); rank ineligibility still has no
 * in-app resolution (surfaced as-is via the real error message), and a full Class
 * gets a real "Join waitlist" follow-up action, since apps/api's own error message
 * for it literally
 * names that as the next step. */
export function ClassBookingRow({
  classItem,
  schoolId,
  navigation,
}: {
  classItem: ClassSummary;
  schoolId: string;
  navigation: NativeStackNavigationProp<AppStackParamList>;
}) {
  const [state, setState] = useState<RowState>({ kind: 'idle' });
  const [actionError, setActionError] = useState<string | null>(null);
  const bookClass = useBookClass();
  const joinWaitlist = useJoinWaitlist();
  const withdrawWaitlist = useWithdrawWaitlist();

  async function handleBook() {
    // Re-entrancy guard: Button disables on `loading`, but that only takes effect on
    // the next render — a fast double-tap can fire both presses before then. Checked
    // synchronously here rather than relied on the UI alone (found on review).
    if (bookClass.isPending) return;
    setActionError(null);
    try {
      await bookClass.mutateAsync(classItem.id);
      setState({ kind: 'booked' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setState({ kind: 'full' });
      } else if (err instanceof ApiError && err.code === 'WAIVER_REQUIRED') {
        // Deep-link to the Waivers screen instead of the previous dead-end — the
        // stable `code` (not the free-text message) is what makes this safe to
        // detect; see bookings.service.ts's own comment on why text-matching was
        // rejected earlier.
        setState({ kind: 'waiverRequired' });
      } else {
        setActionError(getApiErrorMessage(err, 'Could not book this class — please try again.'));
      }
    }
  }

  async function handleJoinWaitlist() {
    if (joinWaitlist.isPending) return;
    setActionError(null);
    try {
      const entry = await joinWaitlist.mutateAsync(classItem.id);
      setState({ kind: 'waitlisted', entryId: entry.id, position: entry.position });
    } catch (err) {
      // Stay on 'full' (not idle) — the class is still full either way, and this
      // keeps "Join waitlist" as the visible next action rather than silently
      // reverting to "Book", which would just 409 again.
      setActionError(getApiErrorMessage(err, 'Could not join the waitlist — please try again.'));
    }
  }

  async function handleLeaveWaitlist(entryId: string) {
    if (withdrawWaitlist.isPending) return;
    setActionError(null);
    try {
      await withdrawWaitlist.mutateAsync(entryId);
      setState({ kind: 'idle' });
    } catch (err) {
      // Deliberately do NOT clear `state` here — losing `entryId` on a transient
      // failure would be unrecoverable (no way to look it back up), stranding the
      // Student on the waitlist with only a "Book" button that will just 409 again.
      setActionError(getApiErrorMessage(err, 'Could not leave the waitlist — please try again.'));
    }
  }

  return (
    <View style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: fontWeight.heading }}>{classItem.title}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption }}>
        {formatDate(classItem.startDate)} – {formatDate(classItem.endDate)}
      </Text>

      {actionError ? <InlineError message={actionError} /> : null}

      {state.kind === 'idle' ? <Button title="Book" onPress={handleBook} loading={bookClass.isPending} /> : null}

      {state.kind === 'booked' ? (
        <Text style={{ color: theme.textSuccess, fontSize: fontSize.caption, marginTop: spacing[1] }}>Booked ✓</Text>
      ) : null}

      {state.kind === 'waiverRequired' ? (
        <>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>
            You need a signed waiver for this School before booking.
          </Text>
          <Button
            title="Sign waiver"
            variant="secondary"
            onPress={() => navigation.navigate('Waivers', { schoolId })}
          />
        </>
      ) : null}

      {state.kind === 'full' ? (
        <>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>This class is full.</Text>
          <Button title="Join waitlist" variant="secondary" onPress={handleJoinWaitlist} loading={joinWaitlist.isPending} />
        </>
      ) : null}

      {state.kind === 'waitlisted' ? (
        <>
          <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>
            You're #{state.position} on the waitlist.
          </Text>
          <Button
            title="Leave waitlist"
            variant="secondary"
            onPress={() => handleLeaveWaitlist(state.entryId)}
            loading={withdrawWaitlist.isPending}
          />
        </>
      ) : null}
    </View>
  );
}
