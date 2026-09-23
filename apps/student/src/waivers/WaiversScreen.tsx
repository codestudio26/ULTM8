import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import type { components } from '@ultm8/api-client';
import { ErrorBanner, Screen } from '../components/ui';
import { PaginatedListScreen } from '../components/PaginatedListScreen';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useEnrolledSchoolId } from '../auth/AuthContext';
import { WaiverRow } from './WaiverRow';
import { useMyWaiverSignatures, useSchoolWaivers } from './waiverQueries';

type Waiver = components['schemas']['WaiverResponseDto'];

/** Off Home, alongside My Bookings/Memberships/Notifications. `GET /schools/
 * {schoolId}/waivers` needs a schoolId the caller holds a RoleGrant at — see
 * `useEnrolledSchoolId`'s own header comment for why this only resolves ONE
 * School (a known, deliberate scope limit for a multi-School Student, not a
 * silent shortcut — proper multi-School support is a separate follow-up). */
export function WaiversScreen() {
  const schoolId = useEnrolledSchoolId();
  const waivers = useSchoolWaivers(schoolId);
  const mySignatures = useMyWaiverSignatures(!!schoolId);

  if (!schoolId) {
    return (
      <Screen>
        <Text style={{ color: '#5F6368' }}>You're not enrolled at a School yet — waivers appear here once you are.</Text>
      </Screen>
    );
  }

  // Gated on BOTH queries settling, not just `waivers` — found on review: if
  // `waivers` resolves before `mySignatures`, every already-signed Waiver would
  // briefly show an active "Sign" button (signaturesByWaiverId still empty), and a
  // tap during that window hits the backend's 409 for a Waiver the Student had
  // already signed. Same discipline as MyRankSection gating on both its own two
  // queries settling before rendering anything.
  if (waivers.isLoading || mySignatures.isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  // FOUND ON REVIEW (a second pass): can't delegate mySignatures' failure to
  // PaginatedListScreen's own isError handling below — that only shows a full-screen
  // error when `waivers` itself has zero items, the right call for a background
  // page-2 fetch failure (MyMinorsScreen's own analogous comment), but wrong here:
  // signaturesByWaiverId feeds every WaiverRow's Sign/Signed state, so a failed
  // mySignatures fetch makes the derived signed/unsigned status unknown, not just
  // "background data missing" — rendering the list anyway would silently show every
  // already-signed Waiver as needing a signature. Blocked explicitly instead,
  // regardless of whether `waivers` itself has items.
  if (mySignatures.isError) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(mySignatures.error, 'Failed to load your waiver signatures — please try again.')} />
      </Screen>
    );
  }

  // Only a `SIGNED` signature counts as "already signed" — `WaiverSignatureStatus`
  // also has UNSIGNED/EXPIRED/PENDING values (schema.prisma), currently unreachable
  // since sign() always creates SIGNED rows, but latent: a future re-sign/expiry
  // flow writing a non-SIGNED row here must not make WaiverRow show a permanent
  // "Signed ✓" for a Waiver the Student actually still needs to sign.
  const signaturesByWaiverId = new Map(
    (mySignatures.data?.items ?? []).filter((s) => s.status === 'SIGNED').map((s) => [s.waiverId, s]),
  );

  return (
    <PaginatedListScreen
      query={waivers}
      renderItem={(item: Waiver) => <WaiverRow waiver={item} signature={signaturesByWaiverId.get(item.id)} />}
      emptyMessage="No waivers to sign."
      errorFallbackMessage="Failed to load waivers — please try again."
    />
  );
}
