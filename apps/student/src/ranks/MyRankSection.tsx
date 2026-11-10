import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import type { components } from '@ultm8/api-client';
import { InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useRank } from './rankQueries';
import { useT } from '../i18n/I18nProvider';

type StudentRank = components['schemas']['StudentRankResponseDto'];
type StudentRankList = components['schemas']['StudentRankListResponseDto'];
type DisciplineList = components['schemas']['DisciplineListResponseDto'];

/** The belt's name and stripes, as the School typed them for the rung (e.g.
 * "Blue Belt · 2 Stripes"), as My Grading shows them; the belt's own name
 * when no rung matches (Decision 450 item 4). The demo showed "Rank 13 · 3 stripes" (the ladder
 * position), which a member can't read. `currentStripeId`, when set, is matched
 * against the resolved Rank's own `stripeTiers` array to find the rung. This
 * is the one genuinely unavoidable per-row fetch (confirmed on review: no batch
 * `GET /ranks?ids=` endpoint exists) — flagged as a backend follow-up, not "fixed"
 * client-side. */
function MyRankRow({ studentRank, disciplineName }: { studentRank: StudentRank; disciplineName: string }) {
  const t = useT();
  const { data: rank, isLoading, isError, error } = useRank(studentRank.currentRankId);
  const stripeTier = rank?.stripeTiers.find((t) => t.id === studentRank.currentStripeId) ?? null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      {rank ? (
        <View
          style={{
            width: 22,
            height: 22,
            // A level (Decision 290) is a round badge with one colour.
            borderRadius: rank.rankDisplay === 'LEVELS' ? 11 : 5,
            backgroundColor: rank.primaryColour,
            borderWidth: rank.secondaryColour && rank.rankDisplay !== 'LEVELS' ? 3 : 0,
            borderColor: rank.secondaryColour ?? undefined,
            marginRight: 12,
          }}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600' }}>{disciplineName}</Text>
        {isLoading ? <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('ranks.myRank.loading')}</Text> : null}
        {isError ? <InlineError message={getApiErrorMessage(error, t('ranks.myRank.rankError'))} /> : null}
        {rank ? (
          <Text style={{ color: '#5F6368', fontSize: 12 }}>
            {stripeTier?.name ?? rank.name}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "My Rank" — a section on AcademyDetailScreen (Slice 3), not a standalone screen.
 * GET /students/{id}/ranks requires a schoolId (a Student's ranks are School-scoped)
 * — the caller already has one in scope here (this IS the School's own detail
 * screen; Academy.id IS School.id — verified directly via
 * AcademiesController.findOne → AcademiesService.findOne's Prisma call, not
 * inferred from the DTO shape), so no school-picker is needed. See
 * docs/TRACK-B-ROADMAP.md's Slice 3 section for the full verification trail.
 *
 * Takes both queries as props (fetched by the caller, AcademyDetailScreen) rather
 * than calling the hooks internally — found on review: calling them here meant they
 * never started until this component mounted, which only happens after
 * AcademyDetailScreen's own `useAcademy` finishes loading, even though this data
 * needs nothing from `academy` (only `academyId`/`studentId`, both available
 * synchronously). Hoisting them to the caller lets them fire in parallel with every
 * other query this screen makes. */
export function MyRankSection({
  studentRanks,
  disciplines,
}: {
  studentRanks: UseQueryResult<StudentRankList>;
  disciplines: UseQueryResult<DisciplineList>;
}) {
  const t = useT();
  const { data: ranksData, isLoading: ranksLoading, isError: ranksIsError, error: ranksError } = studentRanks;
  const { data: disciplinesData, isLoading: disciplinesLoading, isError: disciplinesIsError, error: disciplinesError } = disciplines;

  const ranks = ranksData?.items ?? [];
  const disciplineNameById = useMemo(
    () => new Map((disciplinesData?.items ?? []).map((d) => [d.id, d.name])),
    [disciplinesData],
  );

  // Wait for BOTH queries to settle before rendering anything — found on review:
  // gating only on `ranksLoading` let rows render with "Unknown discipline" for the
  // moment before the (separately-fetched) discipline names arrived. No dedicated
  // spinner while waiting, matching this same screen's own Timetable section, which
  // renders nothing until its data is ready rather than showing its own loading UI.
  if (ranksLoading || disciplinesLoading) return null;

  // Nothing to show — most Students browsing an Academy aren't graded (or even
  // enrolled) there; rendering nothing here matches how Activities/Upcoming-classes/
  // Timetable above already hide themselves when empty, rather than asserting a
  // Student/School relationship ("not yet graded") the data available on this
  // screen can't actually confirm.
  if (!ranksIsError && ranks.length === 0) return null;

  // FOUND ON REVIEW: showing the error unconditionally whenever `ranksIsError`
  // was true replaced already-loaded ranks with an inline error the moment
  // any background refetch failed. Only block on it when there's genuinely
  // nothing cached to show (the check above already handles "no error, no
  // data" by rendering nothing at all).
  if (ranksIsError && ranks.length === 0) {
    return (
      <View style={{ marginTop: 16 }}>
        <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('ranks.myRank.title')}</Text>
        <InlineError message={getApiErrorMessage(ranksError, t('ranks.myRank.loadError'))} />
      </View>
    );
  }

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>{t('ranks.myRank.title')}</Text>
      {disciplinesIsError ? (
        <InlineError message={getApiErrorMessage(disciplinesError, t('ranks.myRank.disciplinesError'))} />
      ) : null}
      {ranks.map((r) => (
        <MyRankRow key={r.id} studentRank={r} disciplineName={disciplineNameById.get(r.disciplineId) ?? t('ranks.myRank.unknownDiscipline')} />
      ))}
    </View>
  );
}
