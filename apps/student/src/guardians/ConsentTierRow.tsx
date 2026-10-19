import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useGrantConsent, useWithdrawConsent } from './guardianQueries';

type ConsentRecord = components['schemas']['ConsentRecordResponseDto'];
type ConsentTier = 'BASELINE' | 'CAMERA';

/** CANDIDATE UI, pending your approval per docs/TRACK-B-ROADMAP.md's "path
 * forward" — the underlying API (GuardiansController/Service) is real and
 * confirmed; what's undesigned is this exact screen/copy. The policy version is
 * the published privacy notice's (Decision 171), passed in by
 * MinorConsentScreen; null while none is published or the link is unconfirmed,
 * and then `blockedReason` says why consent can't be given yet. */

/** Copy quotes SKILL.md §14's own confirmed description of what each tier
 * covers and what withdrawing each one actually does (GuardiansService.
 * withdrawConsent's own header comment) — not invented, since a Guardian
 * deciding whether to withdraw BASELINE consent needs to know it deactivates
 * their minor's entire account before they tap it, not after. */
const TIER_COPY: Record<ConsentTier, { title: string; description: string; withdrawWarning: string }> = {
  BASELINE: {
    title: 'Baseline consent',
    description: "Covers your minor's general account, attendance, and grading data — required for their account to stay active.",
    withdrawWarning:
      "Withdrawing baseline consent permanently erases your child's account data — grading, bookings and attendance — and ends their enrolments. Payment records and signed waivers are kept, as the law requires. If another guardian still consents, only your own consent and link are removed and your child's data is kept. This cannot be undone.",
  },
  CAMERA: {
    title: 'Camera & photo consent',
    description: 'Covers self-service QR check-in camera use and profile-photo capture.',
    withdrawWarning:
      "Withdrawing camera consent disables self-service QR check-in and clears your minor's stored profile photo. It does not affect their account, attendance, or grading history.",
  },
};

export function ConsentTierRow({
  studentId,
  tier,
  record,
  policyVersion,
  blockedReason,
}: {
  studentId: string;
  tier: ConsentTier;
  record: ConsentRecord | undefined;
  policyVersion: string | null;
  blockedReason: string | null;
}) {
  const grant = useGrantConsent();
  const withdraw = useWithdrawConsent();
  const copy = TIER_COPY[tier];
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // Decision 172 — the Guardian declares parental responsibility before every
  // grant; the server stores it with the consent history.
  const [declared, setDeclared] = useState(false);

  // Same "derive from the mutation's own result, don't wait on a round-tripped
  // prop" discipline as WaiverRow's `effectiveSignature` (found on that slice's
  // own review) — a successful withdraw hides the record immediately instead of
  // showing a stale "Active" state with an inert Withdraw button for one
  // refetch round-trip, and a successful grant shows "Active" immediately.
  // `grant.data` alone (not `grant.isSuccess ? grant.data : undefined`) is
  // already exactly this — react-query's mutation reducer resets `data` to
  // undefined on every new `mutate()` call and only sets it on success.
  //
  // FOUND ON REVIEW: `grant`/`withdraw` are two SEPARATE mutation objects, so
  // calling one never resets the other's leftover `isSuccess`. Without the
  // explicit `.reset()` calls below, withdrawing once and then granting again
  // on the same still-mounted row left `withdraw.isSuccess` permanently `true`
  // — `granted` stayed `undefined` forever after that, even though the
  // backend genuinely had an ACTIVE record, misleading a Guardian into
  // thinking consent was never restored.
  const granted = withdraw.isSuccess ? undefined : (record ?? grant.data);

  function handleGrant() {
    if (grant.isPending || !policyVersion || !declared) return;
    withdraw.reset();
    grant.mutate({ studentId, tier, policyVersion });
  }

  // FOUND ON REVIEW: `Alert.alert` is a documented no-op on React Native Web —
  // this app's own interactive-test target — so the previous Alert-based
  // confirmation never actually appeared there at all; tapping "Withdraw" did
  // nothing, silently, on the one platform this app is actually click-tested
  // against. Replaced with an inline confirmation panel (plain Views/Text, no
  // native dialog API), which renders identically on every platform. BASELINE
  // additionally requires an explicit tap-to-acknowledge before its Withdraw
  // enables — proportional to what it actually does (deactivates the minor's
  // entire account, every role and enrollment, per copy.withdrawWarning above)
  // versus CAMERA's narrower, non-account-affecting effect, which only needs
  // the one warning read + confirm tap.
  function openConfirm() {
    if (!granted || withdraw.isPending) return;
    setAcknowledged(false);
    setConfirming(true);
  }

  function cancelConfirm() {
    setConfirming(false);
    setAcknowledged(false);
  }

  function confirmWithdraw() {
    // Re-checked here, not just in openConfirm — this is the actual mutate()
    // call site, matching handleGrant/handleWithdraw's existing re-entrancy
    // discipline elsewhere in this file.
    if (!granted || withdraw.isPending) return;
    if (tier === 'BASELINE' && !acknowledged) return;
    setConfirming(false);
    setAcknowledged(false);
    grant.reset();
    withdraw.mutate(granted.id);
  }

  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: fontWeight.heading }}>{copy.title}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>{copy.description}</Text>

      {grant.isError ? (
        <InlineError message={getApiErrorMessage(grant.error, 'Could not save consent — please try again.')} />
      ) : null}
      {withdraw.isError ? (
        <InlineError message={getApiErrorMessage(withdraw.error, 'Could not withdraw consent — please try again.')} />
      ) : null}

      {granted && confirming ? (
        <View style={{ marginTop: spacing[2] }}>
          <Text style={{ color: theme.textDanger, fontSize: fontSize.caption }}>{copy.withdrawWarning}</Text>
          {tier === 'BASELINE' ? (
            <Pressable
              onPress={() => setAcknowledged((a) => !a)}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[2] }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: theme.textDanger,
                  backgroundColor: acknowledged ? theme.textDanger : 'transparent',
                  marginRight: spacing[2],
                }}
              />
              <Text style={{ fontSize: fontSize.caption, flex: 1 }}>I understand this deactivates the account</Text>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: spacing[2], gap: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <Button title="Cancel" variant="secondary" onPress={cancelConfirm} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Confirm withdraw"
                variant="destructive"
                onPress={confirmWithdraw}
                loading={withdraw.isPending}
                disabled={tier === 'BASELINE' && !acknowledged}
              />
            </View>
          </View>
        </View>
      ) : granted ? (
        <>
          <Text style={{ color: theme.textSuccess, fontSize: fontSize.caption, marginTop: spacing[1] }}>Active ✓</Text>
          {granted.isCurrentPolicyVersion === false ? (
            // Decision 171 — the privacy notice changed since this consent was given.
            <Text style={{ color: theme.textDanger, fontSize: fontSize.caption, marginTop: spacing[1] }}>
              The privacy notice has changed since you gave this consent. Please read it and consent again.
            </Text>
          ) : null}
          <Button title="Withdraw" variant="secondary" onPress={openConfirm} loading={withdraw.isPending} />
        </>
      ) : blockedReason ? (
        <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[2] }}>{blockedReason}</Text>
      ) : (
        <>
          <Pressable
            onPress={() => setDeclared((d) => !d)}
            style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[2] }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: declared }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                borderWidth: 1,
                borderColor: theme.textSecondary,
                backgroundColor: declared ? theme.textSecondary : 'transparent',
                marginRight: spacing[2],
              }}
            />
            <Text style={{ fontSize: fontSize.caption, flex: 1 }}>I am this child's parent or legal guardian, and I have read the privacy notice</Text>
          </Pressable>
          <Button title="Grant consent" onPress={handleGrant} loading={grant.isPending} disabled={!declared} />
        </>
      )}
    </View>
  );
}
