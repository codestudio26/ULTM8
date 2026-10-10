import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useEnrolledSchoolIds } from '../auth/AuthContext';
import { WaiverRow } from './WaiverRow';
import { useAllEnrolledSchoolWaivers, useEnrolledSchoolNames, useMyWaiverSignatures } from './waiverQueries';

/** Off Home, alongside My Bookings/Memberships/Notifications. Shows every Waiver
 * across every School the Student holds a STUDENT RoleGrant at (`useEnrolledSchoolIds`)
 * — a Student enrolled at more than one School previously only ever saw the first
 * one, sorted arbitrarily; that gap is what this screen now closes (see
 * `useAllEnrolledSchoolWaivers`'s own header comment in waiverQueries.ts for the
 * "wide single page per School" approach and why). Grouped by School, since a
 * multi-School Student needs to know which Waiver belongs to which School, not just
 * a merged, undifferentiated list. */
export function WaiversScreen() {
  const schoolIds = useEnrolledSchoolIds();
  const waivers = useAllEnrolledSchoolWaivers(schoolIds);
  const mySignatures = useMyWaiverSignatures(schoolIds.length > 0);
  const schoolNames = useEnrolledSchoolNames(schoolIds);

  if (schoolIds.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>You're not enrolled at a School yet — waivers appear here once you are.</Text>
      </Screen>
    );
  }

  // Gated on BOTH settling, not just `waivers` — same reasoning as this screen's
  // previous single-School version: if `waivers` resolves before `mySignatures`,
  // every already-signed Waiver would briefly show an active "Sign" button, and a
  // tap during that window hits the backend's 409 for a Waiver already signed.
  if (waivers.isLoading || mySignatures.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  // Same "data takes precedence over a background failure" discipline as
  // PaginatedListScreen — only a full-screen error when there's genuinely nothing
  // to show; a School that failed to load while others succeeded just quietly
  // contributes nothing to the grouped list below, rather than blanking everything
  // already loaded.
  if (waivers.isError && waivers.items.length === 0) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(waivers.error, 'Failed to load waivers — please try again.')} />
      </Screen>
    );
  }

  const signaturesByWaiverId = new Map(
    (mySignatures.data?.items ?? []).filter((s) => s.status === 'SIGNED').map((s) => [s.waiverId, s]),
  );

  const waiversBySchool = new Map<string, typeof waivers.items>();
  for (const waiver of waivers.items) {
    const list = waiversBySchool.get(waiver.schoolId) ?? [];
    list.push(waiver);
    waiversBySchool.set(waiver.schoolId, list);
  }

  if (waivers.items.length === 0) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>No waivers to sign.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        {schoolIds
          .filter((schoolId) => waiversBySchool.has(schoolId))
          .map((schoolId) => (
            <View key={schoolId} style={{ marginBottom: 20 }}>
              {schoolIds.length > 1 ? (
                <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
                  {schoolNames.get(schoolId) ?? schoolId}
                </Text>
              ) : null}
              {waiversBySchool.get(schoolId)!.map((waiver) => (
                <WaiverRow key={waiver.id} waiver={waiver} signature={signaturesByWaiverId.get(waiver.id)} />
              ))}
            </View>
          ))}
      </ScrollView>
    </Screen>
  );
}
