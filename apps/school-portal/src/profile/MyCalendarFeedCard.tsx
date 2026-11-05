import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { calendarFeedUrl, useCreateMyCalendarFeed, useDeleteMyCalendarFeed, useMyCalendarFeed } from '../schools/scheduleSharingQueries';

/**
 * Decision 319 item 4: a staff member's classes in their Google Calendar.
 * A private link to the classes they teach at the School they're working
 * in, which they add in Google Calendar ("Other calendars", "From URL").
 * Shown only to staff (owner, Branch Staff, coach); the School switches it
 * on. A new link turns the old one off; "Stop" removes it.
 */
export function MyCalendarFeedCard() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const feed = useMyCalendarFeed(schoolId);
  const create = useCreateMyCalendarFeed(schoolId ?? '');
  const remove = useDeleteMyCalendarFeed(schoolId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!schoolId || !feed.data) return null;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setCopied(false);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const link = feed.data.feed ? calendarFeedUrl(feed.data.feed.token) : null;
  return (
    <Card>
      <section aria-label={t('schools.scheduleSharing.myTitle')}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.scheduleSharing.myTitle')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.scheduleSharing.mySubtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {!feed.data.enabled ? (
          <p>{t('schools.scheduleSharing.myOff')}</p>
        ) : link ? (
          <>
            <Field label={t('schools.scheduleSharing.myLinkLabel')} htmlFor="my-calendar-link" hint={t('schools.scheduleSharing.myLinkHint')}>
              <TextField id="my-calendar-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            {copied ? <SuccessBanner message={t('schools.scheduleSharing.copied')} /> : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                }}
              >
                {t('schools.scheduleSharing.copy')}
              </Button>
              <Button variant="secondary" loading={create.isPending} onClick={() => run(() => create.mutateAsync())}>
                {t('schools.scheduleSharing.newLink')}
              </Button>
              <Button variant="secondary" loading={remove.isPending} onClick={() => run(() => remove.mutateAsync())}>
                {t('schools.scheduleSharing.myStop')}
              </Button>
            </div>
            <p className="ultm8-field__hint">{t('schools.scheduleSharing.myPrivate')}</p>
          </>
        ) : (
          <Button loading={create.isPending} onClick={() => run(() => create.mutateAsync())}>
            {t('schools.scheduleSharing.myCreate')}
          </Button>
        )}
      </section>
    </Card>
  );
}
