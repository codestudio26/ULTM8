import React from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useClass } from '../classes/classQueries';
import { useClassQrToken } from './attendanceQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import '../schedule/schedule.css';
import '../classes/classDetail.css';
import './attendanceLook.css';

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
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const classId = id ?? null;
  const { data: cls, isLoading: classLoading, error: classError } = useClass(classId);
  const { data: qrToken, isLoading: tokenLoading, error: tokenError, isRefetching } = useClassQrToken(classId);

  if (!classId) return null;
  if (classLoading || (tokenLoading && !qrToken)) return <Spinner />;
  if (classError) {
    return <ErrorBanner message={classError instanceof ApiError ? classError.message : t('attendance.qrCode.loadFailed')} />;
  }
  if (tokenError) {
    return (
      <ErrorBanner
        message={tokenError instanceof ApiError ? tokenError.message : t('attendance.qrCode.tokenFailed')}
      />
    );
  }

  // New look (Decision 460 item 17): the shell's header and the class
  // page's white card; the QR code, its refresh and the typed code are as before.
  return (
    <>
      <NewLookPageHeader
        title={cls ? t('attendance.qrCode.titleWithClass', { title: cls.title }) : t('attendance.qrCode.title')}
        subtitle={cls ? `${new Date(cls.startDate).toLocaleString(formatLocale())} – ${new Date(cls.endDate).toLocaleString(formatLocale())}` : undefined}
      />
      <NewLookPage>
        <section className="u8s-card u8cd-card u8at-qr">
          {qrToken ? (
            <div className="u8at-qr__code">
              <QRCodeSVG value={qrToken.token} size={320} level="M" style={{ opacity: isRefetching ? 0.6 : 1 }} />
            </div>
          ) : (
            <Spinner />
          )}
          <p className="u8at-qr__explanation">{t('attendance.qrCode.explanation')}</p>
          {qrToken?.code && (
            <div className="u8at-qr__typed" style={{ opacity: isRefetching ? 0.6 : 1 }}>
              <p className="u8at-qr__hint">{t('attendance.qrCode.typeCodeHint')}</p>
              <p className="u8at-qr__digits">{qrToken.code}</p>
            </div>
          )}
        </section>
      </NewLookPage>
    </>
  );
}
