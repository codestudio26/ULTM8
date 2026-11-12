import React from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useBirthdays } from './dashboardQueries';
import { formatDay } from './dashboardDates';
import { useT } from '../i18n/I18nProvider';
import { DashCard } from './DashCard';

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
    <DashCard icon="students" title={t('dashboard.birthdays.title')}>
      {birthdays.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : birthdays.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={birthdays.error instanceof ApiError ? birthdays.error.message : t('dashboard.birthdays.loadFailed')} />
        </div>
      ) : items.length === 0 ? (
        <p className="u8n-dash__empty">{t('dashboard.birthdays.empty')}</p>
      ) : (
        <ul className="u8n-dash__rows">
          {items.map((b) => {
            const name = `${b.firstName} ${b.surname}`;
            return (
              <li key={b.studentId} className="u8n-dash__row">
                <div className="u8n-dash__row-main">
                  <div className="u8n-dash__row-name">{linkToStudent ? <Link to={`/students/${b.studentId}`}>{name}</Link> : name}</div>
                </div>
                <div className="u8n-dash__row-end u8n-dash__row-sub">
                  {b.date === birthdays.data?.today ? t('dashboard.birthdays.today') : formatDay(b.date)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
