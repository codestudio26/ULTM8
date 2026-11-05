import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, SuccessBanner, Switch, TextArea } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useI18n, useT } from '../i18n/I18nProvider';
import { scheduleEmbedSnippet, scheduleEmbedUrl, useScheduleSharing, useUpdateScheduleSharing, type UpdateScheduleSharingInput } from './scheduleSharingQueries';

/**
 * Decision 319 item 4: two schedule settings on the School page (owner only).
 * "Staff can add their classes to Google Calendar" lets each staff member
 * make a private calendar link on My Profile. "Show your schedule on your
 * website" gives an embed snippet with the School's public schedule (class
 * names, times, Branch; no coaches or members). A new link turns the old one
 * off.
 */
export function ScheduleSharingCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const { locale } = useI18n();
  const settings = useScheduleSharing(schoolId);
  const update = useUpdateScheduleSharing(schoolId);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function change(body: UpdateScheduleSharingInput) {
    setError(null);
    setCopied(false);
    try {
      await update.mutateAsync(body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const data = settings.data;
  const key = data?.scheduleEmbedKey ?? null;
  const snippet = key ? scheduleEmbedSnippet(key, locale, t('schools.scheduleSharing.embedFrameTitle')) : '';

  return (
    <Card>
      <section aria-label={t('schools.scheduleSharing.title')}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.scheduleSharing.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.scheduleSharing.subtitle')}</p>
        {error || settings.isError ? <ErrorBanner message={error ?? t('schools.scheduleSharing.loadFailed')} /> : null}
        {data ? (
          <>
            <Switch
              id="staff-calendar-feeds"
              label={t('schools.scheduleSharing.calendarLabel')}
              checked={data.staffCalendarFeedsEnabled}
              onChange={(v) => change({ staffCalendarFeedsEnabled: v })}
            />
            <p className="ultm8-field__hint">{t('schools.scheduleSharing.calendarHint')}</p>
            <div style={{ marginTop: 16 }}>
              <Switch id="schedule-embed" label={t('schools.scheduleSharing.embedLabel')} checked={!!key} onChange={(v) => change({ scheduleEmbedEnabled: v })} />
              <p className="ultm8-field__hint">{t('schools.scheduleSharing.embedHint')}</p>
            </div>
            {key ? (
              <div style={{ marginTop: 8 }}>
                <Field label={t('schools.scheduleSharing.snippetLabel')} htmlFor="schedule-embed-snippet" hint={t('schools.scheduleSharing.snippetHint')}>
                  <TextArea id="schedule-embed-snippet" readOnly rows={3} value={snippet} onFocus={(e) => e.currentTarget.select()} />
                </Field>
                {copied ? <SuccessBanner message={t('schools.scheduleSharing.copied')} /> : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(snippet);
                      setCopied(true);
                    }}
                  >
                    {t('schools.scheduleSharing.copy')}
                  </Button>
                  <a className="ultm8-btn ultm8-btn--secondary" href={scheduleEmbedUrl(key, locale)} target="_blank" rel="noreferrer">
                    {t('schools.scheduleSharing.preview')}
                  </a>
                  <Button variant="secondary" loading={update.isPending} onClick={() => change({ newEmbedKey: true })}>
                    {t('schools.scheduleSharing.newLink')}
                  </Button>
                </div>
                <p className="ultm8-field__hint">{t('schools.scheduleSharing.newLinkHint')}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </Card>
  );
}
