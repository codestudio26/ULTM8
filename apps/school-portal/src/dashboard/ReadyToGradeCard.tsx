import React from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useReadyToGrade } from './dashboardQueries';
import { ranksQuery, type RankResponse } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { BeltChip } from '../grading/BeltChip';
import { Avatar } from '../lib/Avatar';
import { useT } from '../i18n/I18nProvider';
import { DashCard } from './DashCard';

/** The design draws three students, with the count on "See all N →". */
const SHOWN = 3;

/**
 * "Ready to grade" on the owner's Dashboard (Decision 454 item 8; DESIGN.md →
 * "Dashboard: nothing shown twice": one list, not a number card as well, its
 * header carrying the count as "See all N →", which opens the Grading Board).
 * The students are the Grading Board's Ready to Grade column, currently
 * attending only, across every style (GET …/grading-board/ready). Each row
 * opens the student's Ranks tab at that style (Decision 457), as the coach
 * dashboard's Ready to grade list does. Students have no Branch filter of
 * their own here, so with a Branch picked it says it is the whole School, as
 * Active students does (Decision 374 item 1).
 */
export function ReadyToGradeCard({ schoolId, branchPicked }: { schoolId: string; branchPicked: boolean }) {
  const t = useT();
  const ready = useReadyToGrade(schoolId);
  const total = ready.data?.total ?? 0;
  const rows = (ready.data?.items ?? []).slice(0, SHOWN);
  const styleIds = [...new Set(rows.map((r) => r.disciplineId))];
  const ladders = useQueries({ queries: styleIds.map((id) => ranksQuery(id)) });
  const rungsOf = new Map(styleIds.map((id, i) => [id, flattenLadder((ladders[i]?.data as { items: RankResponse[] } | undefined)?.items ?? [])]));

  return (
    <DashCard
      icon="grading"
      title={t('coach.dashboard.readyToGrade')}
      action={
        total > 0 ? (
          <Link to="/grading" className="u8n-dash__more" data-testid="ready-see-all">
            {t('dashboard.readySeeAll', { count: total })}
          </Link>
        ) : undefined
      }
    >
      {branchPicked ? <p className="u8n-dash__card-note">{t('dashboard.wholeSchool')}</p> : null}
      {ready.isLoading ? (
        <div className="u8n-dash__row">
          <Spinner />
        </div>
      ) : ready.error ? (
        <div className="u8n-dash__row">
          <ErrorBanner message={ready.error instanceof ApiError ? ready.error.message : t('dashboard.readyLoadFailed')} />
        </div>
      ) : rows.length === 0 ? (
        <p className="u8n-dash__empty">{t('coach.dashboard.noneReady')}</p>
      ) : (
        <ul className="u8n-dash__rows" data-testid="ready-list">
          {rows.map((r) => {
            const ladder = rungsOf.get(r.disciplineId) ?? [];
            const from = ladder.find((x) => x.id === r.currentStripeId);
            const to = ladder.find((x) => x.id === r.nextRungId);
            return (
              <li key={`${r.disciplineId}-${r.studentId}`}>
                <Link
                  to={{ pathname: `/students/${r.studentId}`, search: '?tab=ranks', hash: `#grading-${r.disciplineId}` }}
                  className="u8n-dash__row u8n-dash__row--link"
                  data-testid="ready-row"
                >
                  <Avatar firstName={r.firstName} surname={r.surname} photoUrl={r.photoUrl} size={40} color="var(--u8n-dash-av-bg)" textColor="var(--u8n-dash-av-text)" />
                  <span className="u8n-dash__row-main">
                    <span className="u8n-dash__row-name">
                      {r.firstName} {r.surname}
                    </span>
                    {from && to ? (
                      <span className="u8n-dash__row-sub u8n-dash__row-line">
                        {from.name} → {to.name}
                      </span>
                    ) : null}
                  </span>
                  {from ? <BeltChip rung={from} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}
