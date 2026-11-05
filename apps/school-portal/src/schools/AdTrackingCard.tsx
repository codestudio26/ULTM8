import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

/** The same formats the API accepts (UpdateSchoolDto): a Meta Pixel ID is
 * digits only; a Google Analytics ID is a GA4 measurement ID. Nothing else can
 * be saved, so no script or markup can ever reach a page through these. */
export const META_PIXEL_ID = /^[0-9]{10,20}$/;
export const GOOGLE_ANALYTICS_ID = /^G-[A-Z0-9]{4,16}$/;

/** Spaces dropped, letters upper-cased ("g-ab12" → "G-AB12"); empty → null. */
export function normaliseTrackingId(text: string): string | null {
  const v = text.replace(/\s+/g, '').toUpperCase();
  return v === '' ? null : v;
}

/**
 * Decision 318 item 10: the School's ad tracking, as ready-made connections
 * only. The owner enters a Meta Pixel ID and/or a Google Analytics ID; no
 * custom code. Saved only: no ULTM8 page loads them yet (see the PR's
 * questions on which pages and on visitors' consent).
 */
export function AdTrackingCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [pixel, setPixel] = useState(school.metaPixelId ?? '');
  const [ga, setGa] = useState(school.googleAnalyticsId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const pixelValue = normaliseTrackingId(pixel);
  const gaValue = normaliseTrackingId(ga);
  const pixelOk = pixelValue === null || META_PIXEL_ID.test(pixelValue);
  const gaOk = gaValue === null || GOOGLE_ANALYTICS_ID.test(gaValue);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pixelOk || !gaOk) return;
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync({ metaPixelId: pixelValue, googleAnalyticsId: gaValue });
      setPixel(updated.metaPixelId ?? '');
      setGa(updated.googleAnalyticsId ?? '');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form id="ad-tracking" onSubmit={save}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('adTracking.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>{t('adTracking.subtitle')}</p>
        <p className="ultm8-field__hint" style={{ margin: '0 0 16px' }}>
          {t('adTracking.notUsedYet')}
        </p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <Field label={t('adTracking.metaPixelLabel')} htmlFor="ad-tracking-pixel" hint={t('adTracking.metaPixelHint')} error={pixelOk ? undefined : t('adTracking.metaPixelInvalid')}>
          <TextField
            id="ad-tracking-pixel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            value={pixel}
            onChange={(e) => {
              setPixel(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <Field label={t('adTracking.googleAnalyticsLabel')} htmlFor="ad-tracking-ga" hint={t('adTracking.googleAnalyticsHint')} error={gaOk ? undefined : t('adTracking.googleAnalyticsInvalid')}>
          <TextField
            id="ad-tracking-ga"
            autoComplete="off"
            maxLength={40}
            value={ga}
            onChange={(e) => {
              setGa(e.target.value);
              setSaved(false);
            }}
          />
        </Field>
        <div style={{ marginTop: 16 }}>
          <Button type="submit" loading={update.isPending} disabled={!pixelOk || !gaOk}>
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
