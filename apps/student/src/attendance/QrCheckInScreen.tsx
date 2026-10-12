import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useMyQrToken } from './attendanceQueries';
import { QrScanner } from './QrScanner';

type Mode = 'show' | 'scan';

/** Off Home, alongside My Bookings/Memberships/Notifications/Waivers (Phase 51,
 * Decision 107) — now both halves of the QR check-in design, toggled by mode:
 *
 * - **"Show my code"** (the original, still-default view): a single,
 *   class-agnostic personal code, meant to be left open on-screen and shown
 *   to an Instructor during roll-call for whichever Class the Student has an
 *   Upcoming Booking on (the Class match happens server-side in
 *   instructorScan(), not here — see useMyQrToken's own header comment).
 * - **"Scan to check in"** (`QrScanner.tsx`) — the self-service camera-scan
 *   path (`POST /attendance/scan`). Previously flagged here as "a separate,
 *   not-yet-decided direction... deliberately not built" — see
 *   `QrScanner.tsx`'s own header comment for why that's no longer true.
 *
 * `react-native-qrcode-svg` (backed by `react-native-svg`) was chosen over a
 * pure-JS/Node `qrcode`-style renderer specifically to keep this screen
 * testable the same way every other screen in this app already is —
 * `react-native-svg` is one of Expo Go's bundled native modules (confirmed
 * against Expo's own documented module list), unlike a custom-dev-client-only
 * library (the exact tradeoff Slice 4b's own Stripe/PaymentSheet research
 * flagged for the user's decision). Verified in this sandbox only via a clean
 * `tsc --noEmit` and `expo export --platform web` build — this sandbox has no
 * way to launch a real Expo Go client or device, so the native-module path
 * itself is unexercised here; flagged, not asserted as device-verified. */
export function QrCheckInScreen() {
  const [mode, setMode] = useState<Mode>('show');
  const { data, isLoading, isError, error, isRefetching } = useMyQrToken(mode === 'show');

  return (
    <Screen>
      <View style={{ flexDirection: 'row', marginBottom: 16, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Show my code" variant={mode === 'show' ? 'primary' : 'secondary'} onPress={() => setMode('show')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Scan to check in" variant={mode === 'scan' ? 'primary' : 'secondary'} onPress={() => setMode('scan')} />
        </View>
      </View>

      {mode === 'scan' ? (
        <QrScanner />
      ) : isLoading ? (
        <ActivityIndicator testID="activity-indicator" />
      ) : // Same "data takes precedence over a background refetch failure" discipline
      // every other screen in this app already follows (MyMinorsScreen,
      // WaiversScreen, ...) — only a full-screen error when there's genuinely
      // nothing cached to show.
      isError && !data ? (
        <ErrorBanner message={getApiErrorMessage(error, 'Could not generate your check-in code — please try again.')} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {data ? (
            <View style={{ opacity: isRefetching ? 0.6 : 1 }}>
              <QRCode value={data.token} size={260} />
            </View>
          ) : (
            <ActivityIndicator testID="activity-indicator" />
          )}
          <Text style={{ color: '#5F6368', fontSize: 14, textAlign: 'center', maxWidth: 280 }}>
            Show this to your Instructor to check in. It refreshes automatically — no action needed.
          </Text>
        </View>
      )}
    </Screen>
  );
}
