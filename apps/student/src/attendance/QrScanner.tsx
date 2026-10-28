import React, { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Button, ErrorBanner, SuccessBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { decodeJwtPayload } from '../auth/decodeJwt';
import { useScanAttendance } from './attendanceQueries';
import { useT } from '../i18n/I18nProvider';

/** The "scan to check in" half of the self-service camera-scan path
 * (`POST /attendance/scan`, Phase 51/Decision 107) — the counterpart to the
 * School Portal's `ClassQrCodePage`, which displays the rotating QR this
 * scans. Previously flagged in `QrCheckInScreen.tsx`'s own header comment as
 * "a separate, not-yet-decided direction... deliberately not built here" —
 * built now that nothing about it was actually undecided: the QR's payload
 * format and the display screen both already exist (Decision 107), and the
 * two open product questions `docs/TRACK-B-ROADMAP.md` once flagged for this
 * (what the rotating code encodes; where the display screen runs
 * operationally) are both resolved or moot — the client only needs to decode
 * whatever token it scans, and where the display screen physically sits
 * doesn't change what this screen does.
 *
 * `expo-camera`'s `CameraView` + `useCameraPermissions` were chosen the same
 * way `QrCheckInScreen.tsx`'s own header comment chose `react-native-svg` —
 * verified directly against the installed package's own type definitions,
 * and `expo-camera` has been one of Expo Go's bundled native modules since
 * SDK 49, so this needs no custom dev client. Verified in this sandbox only
 * via a clean `tsc --noEmit`; this sandbox has no way to launch a real Expo
 * Go client, device, or browser camera permission prompt, so the actual
 * camera capture itself is unexercised here — flagged, not asserted as
 * device-verified. */
export function QrScanner() {
  const t = useT();
  const [permission, requestPermission] = useCameraPermissions();
  const scan = useScanAttendance();
  const [decodeError, setDecodeError] = useState<string | null>(null);
  // Guards against `onBarcodeScanned` firing repeatedly for the same code
  // while it stays in frame (a documented behavior of the underlying native
  // scanner, not a bug) — without this, a single scan fires the mutation
  // dozens of times. Reset only once the Student explicitly asks to scan
  // again, not on a timer, so a still-pending request is never abandoned
  // mid-flight.
  const scanningRef = useRef(true);

  function handleBarcodeScanned({ data }: { data: string }) {
    if (!scanningRef.current || scan.isPending) return;
    const payload = decodeJwtPayload<{ classId?: string }>(data);
    if (!payload?.classId) {
      scanningRef.current = false;
      setDecodeError(t('attendance.qrScanner.notACheckInCode'));
      return;
    }
    scanningRef.current = false;
    setDecodeError(null);
    scan.mutate({ classId: payload.classId, qrToken: data });
  }

  function scanAgain() {
    scan.reset();
    setDecodeError(null);
    scanningRef.current = true;
  }

  if (!permission) {
    return <ActivityIndicator testID="activity-indicator" />;
  }

  if (!permission.granted) {
    return (
      <View style={{ alignItems: 'center', gap: 12, padding: 16 }}>
        <Text style={{ fontSize: 14, textAlign: 'center' }}>
          {t('attendance.qrScanner.permissionNeeded')}
        </Text>
        <Button title={t('attendance.qrScanner.allowCamera')} onPress={requestPermission} />
      </View>
    );
  }

  if (scan.isSuccess) {
    return (
      <View style={{ alignItems: 'center', gap: 12, padding: 16 }}>
        <SuccessBanner message={t('attendance.qrScanner.checkedIn')} />
        <Button title={t('attendance.qrScanner.scanAgain')} variant="secondary" onPress={scanAgain} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flex: 1, minHeight: 280, overflow: 'hidden', borderRadius: 12 }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanningRef.current ? handleBarcodeScanned : undefined}
        />
      </View>
      <Text style={{ fontSize: 13, textAlign: 'center', color: '#5F6368' }}>
        {t('attendance.qrScanner.pointCamera')}
      </Text>
      {scan.isPending ? <ActivityIndicator testID="activity-indicator" /> : null}
      {decodeError ? (
        <>
          <ErrorBanner message={decodeError} />
          <Button title={t('attendance.qrScanner.tryAgain')} variant="secondary" onPress={scanAgain} />
        </>
      ) : null}
      {scan.isError ? (
        <>
          <ErrorBanner message={getApiErrorMessage(scan.error, t('attendance.qrScanner.scanError'))} />
          <Button title={t('attendance.qrScanner.tryAgain')} variant="secondary" onPress={scanAgain} />
        </>
      ) : null}
    </View>
  );
}
