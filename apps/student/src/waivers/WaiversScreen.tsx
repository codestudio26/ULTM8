import React, { useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useEnrolledSchoolIds } from '../auth/AuthContext';
import { WaiverRow } from './WaiverRow';
import { useAllEnrolledSchoolWaivers, useEnrolledSchoolNames, useMyWaiverSignatures } from './waiverQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'Waivers'>;

/** Off Home, alongside My Bookings/Memberships/Notifications. Shows every Waiver
 * across every School the Student holds a STUDENT RoleGrant at (`useEnrolledSchoolIds`)
 * — a Student enrolled at more than one School previously only ever saw the first
 * one, sorted arbitrarily; that gap is what this screen now closes (see
 * `useAllEnrolledSchoolWaivers`'s own header comment in waiverQueries.ts for the
 * "wide single page per School" approach and why). Grouped by School, since a
 * multi-School Student needs to know which Waiver belongs to which School, not just
 * a merged, undifferentiated list. */
export function WaiversScreen({ route }: Props) {
  const deepLinkedSchoolId = route.params?.schoolId;
  const schoolIds = useEnrolledSchoolIds();
  const waivers = useAllEnrolledSchoolWaivers(schoolIds);
  const mySignatures = useMyWaiverSignatures(schoolIds.length > 0);
  const schoolNames = useEnrolledSchoolNames(schoolIds);

  const scrollViewRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef(new Map<string, number>());
  const [hasScrolledToDeepLink, setHasScrolledToDeepLink] = useState(false);

  if (schoolIds.length === 0) {
    return (
      <Screen>
        <Text style={{ color: theme.textSecondary }}>You're not enrolled at a School yet — waivers appear here once you are.</Text>
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
        <Text style={{ color: theme.textSecondary }}>No waivers to sign.</Text>
      </Screen>
    );
  }

  // Deep-linked School first — a Student arriving here from ClassBookingRow's
  // "Sign waiver" button (WAIVER_REQUIRED) wants to see that School's Waivers
  // without hunting through a merged multi-School list.
  const orderedSchoolIds = deepLinkedSchoolId
    ? [deepLinkedSchoolId, ...schoolIds.filter((id) => id !== deepLinkedSchoolId)]
    : schoolIds;

  function handleSectionLayout(schoolId: string, event: LayoutChangeEvent) {
    sectionOffsets.current.set(schoolId, event.nativeEvent.layout.y);
    // One-shot: scroll to the deep-linked section's own measured position the first
    // time it's known, rather than guessing an offset before layout has happened.
    // Reordering it first above already gets it close to the top regardless, so this
    // is a correctness nicety (exact position, not just "near the top"), not the only
    // thing making the deep-link work.
    if (schoolId === deepLinkedSchoolId && !hasScrolledToDeepLink) {
      setHasScrolledToDeepLink(true);
      scrollViewRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true });
    }
  }

  return (
    <Screen>
      <ScrollView ref={scrollViewRef}>
        {orderedSchoolIds
          .filter((schoolId) => waiversBySchool.has(schoolId))
          .map((schoolId) => {
            const isDeepLinked = schoolId === deepLinkedSchoolId;
            return (
              <View
                key={schoolId}
                onLayout={(e) => handleSectionLayout(schoolId, e)}
                style={[
                  { marginBottom: spacing[6], padding: spacing[2], borderRadius: 8 },
                  isDeepLinked ? { backgroundColor: theme.bgWarning } : null,
                ]}
              >
                {schoolIds.length > 1 ? (
                  <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.heading, marginBottom: spacing[1] }}>
                    {schoolNames.get(schoolId) ?? schoolId}
                  </Text>
                ) : null}
                {isDeepLinked ? (
                  <Text style={{ color: theme.textWarning, fontSize: fontSize.caption, marginBottom: spacing[1] }}>
                    Sign a Waiver here to continue booking.
                  </Text>
                ) : null}
                {waiversBySchool.get(schoolId)!.map((waiver) => (
                  <WaiverRow key={waiver.id} waiver={waiver} signature={signaturesByWaiverId.get(waiver.id)} />
                ))}
              </View>
            );
          })}
      </ScrollView>
    </Screen>
  );
}
