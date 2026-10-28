import React from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBirthdays } from './dashboardQueries';
import { formatDay } from './dashboardDates';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 374 (Decision 318 item 2) — this week's birthdays, children
 * included, with the day but never the age. On the owner's Dashboard and the
 * coach dashboard; `linkToStudent` only where the viewer can open a profile.
 */
export function BirthdaysCard({ schoolId, linkToStudent }: { schoolId: string; linkToStudent: boolean }) {
  const t = useT();
  const birthdays = useBirthdays(schoolId);
  const items = birthdays.data?.items ?? [];
  return (
    <section aria-label={t('dashboard.birthdays.title')} style={{ marginBottom: 16 }}>
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: '0 0 8px' }}>
          {t('dashboard.birthdays.title')}
        </h2>
        {birthdays.isLoading ? (
          <Spinner />
        ) : birthdays.error ? (
          <ErrorBanner message={birthdays.error instanceof ApiError ? birthdays.error.message : t('dashboard.birthdays.loadFailed')} />
        ) : items.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--ultm8-color-text-muted, #666)', fontSize: 14 }}>{t('dashboard.birthdays.empty')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {items.map((b) => {
              const name = `${b.firstName} ${b.surname}`;
              return (
                <li key={b.studentId} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 14 }}>
                  <span style={{ minWidth: 120, color: 'var(--ultm8-color-text-muted, #666)' }}>
                    {b.date === birthdays.data?.today ? t('dashboard.birthdays.today') : formatDay(b.date)}
                  </span>
                  {linkToStudent ? <Link to={`/students/${b.studentId}`}>{name}</Link> : <span>{name}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
