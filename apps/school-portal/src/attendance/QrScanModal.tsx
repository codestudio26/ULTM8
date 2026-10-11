import React, { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { Modal } from '@ultm8/ui';

/**
 * Camera-scan half of Instructor roll-call (Decision 107's `INSTRUCTOR_SCAN`
 * mode) — reads the Student's own personal QR (the raw string
 * `GET /attendance/my-qr-token` minted, shown on their device via apps/student's
 * `QrCheckInScreen`) and hands the decoded text back as `studentToken`.
 * `qr-scanner` was chosen over a heavier wrapper (e.g. html5-qrcode) for being
 * dependency-free and a thin layer directly over `getUserMedia` + a Web Worker
 * decoder — Vite's own dynamic-import handling bundles its worker script
 * automatically, same "no extra bundler config" property react-native-webview
 * had for Expo Go on the Student app's own camera work.
 *
 * Scans exactly once per open — the first successful decode calls `onScan` and
 * immediately stops the camera, rather than leaving it running and risking a
 * second, stale decode firing after the caller has already acted on the first.
 */
export function QrScanModal({ onScan, onClose }: { onScan: (token: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stopped = false;
    const scanner = new QrScanner(
      video,
      (result) => {
        if (stopped) return;
        stopped = true;
        scanner.stop();
        onScan(result.data);
      },
      { highlightScanRegion: true, highlightCodeOutline: true },
    );
    scannerRef.current = scanner;
    scanner.start().catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not access the camera — check browser permissions.');
    });

    return () => {
      stopped = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScan is read fresh via the closure above; re-running this effect would restart the camera on every parent re-render.
  }, []);

  return (
    <Modal title="Scan Student's check-in code" onClose={onClose}>
      {error ? (
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
      ) : (
        <div style={{ position: 'relative', width: 320, maxWidth: '100%' }}>
          <video ref={videoRef} style={{ width: '100%', borderRadius: 8 }} muted playsInline />
        </div>
      )}
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 12 }}>
        Point the camera at the code shown on the Student's own device.
      </p>
    </Modal>
  );
}
