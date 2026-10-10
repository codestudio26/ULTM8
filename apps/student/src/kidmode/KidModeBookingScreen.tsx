import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '@ultm8/api-client';
import { Button, ErrorBanner, InlineError, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { useAcademies, useAcademy } from '../academies/academyQueries';
import { useMyMinors } from '../guardians/guardianQueries';
import { useMintKidModeToken, useMyBookingDelegations } from '../guardians/bookingDelegationQueries';
import { bookClassAsKidMode } from './kidModeClient';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'KidModeBooking'>;

/** Decision 123 — the booking half of Kid Mode, reachable only through
 * KidModePinScreen. Deliberately self-contained rather than reusing
 * AcademyDetailScreen/ClassBookingRow — those are wired to useBookClass()'s
 * self-service `apiClient` singleton, exactly the shared-token coupling
 * kidModeClient.ts's own header comment explains why this screen must not
 * touch. Scope matches Decision 123 exactly: book only, against an existing
 * paid credit — no purchase, cancel, or waitlist-join action exists on this
 * screen at all (a full Class surfaces the real 409 message as-is, with no
 * "join waitlist" follow-up, since that's a separate, not-yet-delegated
 * capability).
 */
export function KidModeBookingScreen({ navigation }: Props) {
  const delegations = useMyBookingDelegations();
  const minors = useMyMinors();
  const mintToken = useMintKidModeToken();

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [kidModeToken, setKidModeToken] = useState<string | null>(null);
  const [selectedAcademyId, setSelectedAcademyId] = useState<string | null>(null);
  const [bookingClassId, setBookingClassId] = useState<string | null>(null);
  const [bookedClassIds, setBookedClassIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const academies = useAcademies();
  const academy = useAcademy(selectedAcademyId);

  if (delegations.isLoading || minors.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (delegations.isError && !delegations.data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(delegations.error, 'Could not load Kid Mode — please try again.')} />
      </Screen>
    );
  }

  const activeMinorIds = new Set((delegations.data?.items ?? []).filter((d) => d.status === 'ACTIVE').map((d) => d.studentId));
  const eligibleMinors = (minors.data?.items ?? []).filter((m) => activeMinorIds.has(m.studentId));

  if (eligibleMinors.length === 0) {
    return (
      <Screen>
        <Text style={{ fontSize: 16, textAlign: 'center' }}>No minor is currently enabled for Kid Mode.</Text>
        <Text style={{ color: '#5F6368', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
          Enable it from a minor's own settings first.
        </Text>
      </Screen>
    );
  }

  async function selectMinor(studentId: string) {
    setActionError(null);
    setSelectedStudentId(studentId);
    try {
      const token = await mintToken.mutateAsync(studentId);
      setKidModeToken(token.accessToken);
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Could not start Kid Mode for this minor — please try again.'));
      setSelectedStudentId(null);
    }
  }

  async function handleBook(classId: string) {
    if (!kidModeToken || !selectedStudentId || bookingClassId) return;
    setActionError(null);
    setBookingClassId(classId);
    try {
      await bookClassAsKidMode(kidModeToken, classId, selectedStudentId);
      setBookedClassIds((ids) => [...ids, classId]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setActionError('This class is full.');
      } else {
        setActionError(getApiErrorMessage(err, 'Could not book this class — please try again.'));
      }
    } finally {
      setBookingClassId(null);
    }
  }

  if (!selectedStudentId || !kidModeToken) {
    return (
      <Screen>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 16 }}>Who's booking?</Text>
        {eligibleMinors.map((minor) => (
          <Button
            key={minor.studentId}
            title={`${minor.firstName} ${minor.surname}`}
            onPress={() => selectMinor(minor.studentId)}
            loading={mintToken.isPending && selectedStudentId === minor.studentId}
          />
        ))}
        {actionError ? <InlineError message={actionError} /> : null}
      </Screen>
    );
  }

  const selectedMinorName = eligibleMinors.find((m) => m.studentId === selectedStudentId);

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 4 }}>
          Booking for {selectedMinorName ? `${selectedMinorName.firstName} ${selectedMinorName.surname}` : 'this minor'}
        </Text>
        <Button
          title="Switch minor"
          variant="secondary"
          onPress={() => {
            setSelectedStudentId(null);
            setKidModeToken(null);
            setSelectedAcademyId(null);
          }}
        />

        {actionError ? <InlineError message={actionError} /> : null}

        {!selectedAcademyId ? (
          <View style={{ marginTop: 16 }}>
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Pick an academy</Text>
            {academies.isLoading ? <ActivityIndicator /> : null}
            {academies.data?.pages
              .flatMap((p) => p.items)
              .map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => setSelectedAcademyId(a.id)}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}
                >
                  <Text style={{ fontSize: 16 }}>{a.name}</Text>
                </Pressable>
              ))}
          </View>
        ) : (
          <View style={{ marginTop: 16 }}>
            <Button title="Back to academies" variant="secondary" onPress={() => setSelectedAcademyId(null)} />
            {academy.isLoading ? <ActivityIndicator /> : null}
            {(academy.data?.upcomingClasses ?? []).map((c) => (
              <View key={c.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
                <Text style={{ fontWeight: '600' }}>{c.title}</Text>
                <Text style={{ color: '#5F6368', fontSize: 12 }}>
                  {formatDate(c.startDate)} – {formatDate(c.endDate)}
                </Text>
                {bookedClassIds.includes(c.id) ? (
                  <Text style={{ color: '#188038', fontSize: 13, marginTop: 4 }}>Booked ✓</Text>
                ) : (
                  <Button title="Book" onPress={() => handleBook(c.id)} loading={bookingClassId === c.id} />
                )}
              </View>
            ))}
          </View>
        )}
      </Screen>
    </ScrollView>
  );
}
