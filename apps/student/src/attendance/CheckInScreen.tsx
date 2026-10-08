import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Screen, SuccessBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { spacing, fontSize, fontWeight, theme } from '../theme/tokens';
import { useMyUpcomingBookingsWide } from '../bookings/bookingQueries';
import { useClass, useScanAttendance } from './attendanceQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'CheckIn'>;

/** The nonce/issuedAt pair the school-portal Check-in display regenerates every
 * ~20s (CheckInPage.tsx's own header comment) — this is purely a client-side
 * freshness gate against a screenshot taken earlier; nothing server-side ever
 * inspects it (POST /attendance/scan only ever takes the bookingId below). 45s
 * gives margin over the display's 20s rotation for clock drift and the time it
 * takes a Student to actually scan. */
const MAX_PAYLOAD_AGE_MS = 45_000;

type ScannedPayload = { classId: string; nonce: string; issuedAt: string };

function parsePayload(raw: string): ScannedPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.classId === 'string' && typeof parsed?.nonce === 'string' && typeof parsed?.issuedAt === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function CheckInScreen({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<ScannedPayload | null>(null);
  const [staleCode, setStaleCode] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);

  const upcomingBookings = useMyUpcomingBookingsWide();
  const matchedBooking = scanned
    ? upcomingBookings.data?.items.find((b) => b.classId === scanned.classId && b.status === 'UPCOMING')
    : undefined;
  const classDetail = useClass(matchedBooking ? matchedBooking.classId : null);
  const scanAttendance = useScanAttendance();

  function handleBarcodeScanned({ data }: { data: string }) {
    if (scanned) return; // already processing a scan — ignore further frames
    const payload = parsePayload(data);
    if (!payload) return; // not our QR shape — keep scanning silently
    const age = Date.now() - new Date(payload.issuedAt).getTime();
    if (age > MAX_PAYLOAD_AGE_MS) {
      setStaleCode(true);
      return;
    }
    setScanned(payload);
  }

  function handleScanAgain() {
    setScanned(null);
    setStaleCode(false);
  }

  function handleConfirmCheckIn() {
    if (!matchedBooking || scanAttendance.isPending) return;
    scanAttendance.mutate(matchedBooking.id, { onSuccess: () => setCheckedIn(true) });
  }

  if (checkedIn) {
    return (
      <Screen>
        <SuccessBanner message="You're checked in!" />
        <Button title="Back to Home" onPress={() => navigation.navigate('Home')} />
      </Screen>
    );
  }

  if (!permission) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Text style={{ fontSize: fontSize.body, marginBottom: spacing[3] }}>
          ULTM8 needs camera access to scan a Class's check-in code.
        </Text>
        <Button title="Grant camera access" onPress={() => requestPermission()} />
      </Screen>
    );
  }

  if (staleCode) {
    return (
      <Screen>
        <ErrorBanner message="This code has expired — ask your instructor to refresh it, then scan again." />
        <Button title="Scan again" onPress={handleScanAgain} />
      </Screen>
    );
  }

  if (scanned) {
    return (
      <Screen>
        {upcomingBookings.isLoading ? (
          <ActivityIndicator />
        ) : upcomingBookings.isError ? (
          // FOUND ON REVIEW: previously fell through to the "no booking found" branch
          // below on a fetch failure too, misleadingly telling an actually-booked
          // Student they weren't booked when the real cause was a transient network/
          // server error. Retries the query itself, not just the QR scan.
          <>
            <ErrorBanner message={getApiErrorMessage(upcomingBookings.error, 'Could not check your bookings — please try again.')} />
            <Button title="Try again" onPress={() => upcomingBookings.refetch()} />
            <Button title="Scan again" variant="secondary" onPress={handleScanAgain} />
          </>
        ) : !matchedBooking ? (
          <>
            <ErrorBanner message="You don't have an upcoming booking for this Class." />
            <Button title="Scan again" onPress={handleScanAgain} />
          </>
        ) : (
          <>
            <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, marginBottom: spacing[1] }}>
              {classDetail.data?.title ?? 'Check in'}
            </Text>
            <Text style={{ color: theme.textSecondary, marginBottom: spacing[4] }}>Ready to check in to this Class?</Text>
            {scanAttendance.isError ? (
              <ErrorBanner message={getApiErrorMessage(scanAttendance.error, 'Could not check in — please try again.')} />
            ) : null}
            <Button title="Check in" onPress={handleConfirmCheckIn} loading={scanAttendance.isPending} />
            <Button title="Scan again" variant="secondary" onPress={handleScanAgain} />
          </>
        )}
      </Screen>
    );
  }

  return (
    <View style={styles.cameraContainer}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>Point your camera at the check-in code</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  overlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: spacing[4], backgroundColor: 'rgba(0,0,0,0.5)' },
  overlayText: { color: '#fff', textAlign: 'center', fontSize: fontSize.body },
});
