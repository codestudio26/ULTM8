import React from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Card, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from '../classes/classQueries';
import { useClassQrToken } from './attendanceQueries';

/** Phase 52 — the School Portal's own QR-display screen (Decision 107, Phase 51
 * shipped the endpoint this calls). Meant to be left open on a shared,
 * front-desk-mounted screen: shows one big, auto-refreshing QR code Students
 * scan with their own device to self-check-in to this Class
 * (`POST /attendance/scan`). This is the first interval-polling screen in
 * apps/school-portal — every prior screen only ever fetches on
 * navigation/mutation; see useClassQrToken's own header comment for why the
 * refresh cadence is derived from the token's own `expiresAt` rather than a
 * hardcoded interval.
 *
 * Reached via a per-Class "Show QR" action on ClassesPage, the same pattern
 * "View bookings" already establishes for ClassDetailPage — not a new
 * top-level nav item. A Staff member picks a Class from the list they already
 * manage there; a separate, standalone Class picker screen would just be a
 * second, redundant way to do the same thing. */
export function ClassQrCodePage() {
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: qrToken, isLoading: tokenLoading, error: tokenError, isRefetching } = useClassQrToken(classId);

  if (!classId) return null;
  if (classLoading || (tokenLoading && !qrToken)) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : 'Could not load this Class.'} />;
  }
  if (tokenError) {
    return (
      <ErrorBanner
        message={tokenError instanceof ApiError ? tokenError.message : 'Could not generate a QR code for this Class.'}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={cls ? `QR check-in — ${cls.title}` : 'QR check-in'}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString()} – ${new Date(cls.endDate).toLocaleString()}` : undefined}
      />
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
          {qrToken ? (
            <QRCodeSVG value={qrToken.token} size={320} level="M" style={{ opacity: isRefetching ? 0.6 : 1 }} />
          ) : (
            <Spinner />
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', maxWidth: 360 }}>
            Students scan this from their own device to check in. It refreshes automatically — no action needed.
          </p>
        </div>
      </Card>
    </>
  );
}
