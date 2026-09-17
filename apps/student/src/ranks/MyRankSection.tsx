import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import type { UseQueryResult } from '@tanstack/react-query';
import type { components } from '@ultm8/api-client';
import { InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useRank } from './rankQueries';

type StudentRank = components['schemas']['StudentRankResponseDto'];
type StudentRankList = components['schemas']['StudentRankListResponseDto'];
type DisciplineList = components['schemas']['DisciplineListResponseDto'];

/** A Rank has no name — belt colour + order + (if awarded) a stripe count is the real
 * shape (see rankQueries.ts's own comment). `currentStripeId`, when set, is matched
 * against the resolved Rank's own `stripeTiers` array to find the count/colour. This
 * is the one genuinely unavoidable per-row fetch (confirmed on review: no batch
 * `GET /ranks?ids=` endpoint exists) — flagged as a backend follow-up, not "fixed"
 * client-side. */
function MyRankRow({ studentRank, disciplineName }: { studentRank: StudentRank; disciplineName: string }) {
  const { data: rank, isLoading, isError, error } = useRank(studentRank.currentRankId);
  const stripeTier = rank?.stripeTiers.find((t) => t.id === studentRank.currentStripeId) ?? null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      {rank ? (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            backgroundColor: rank.primaryColour,
            borderWidth: rank.secondaryColour ? 3 : 0,
            borderColor: rank.secondaryColour ?? undefined,
            marginRight: 12,
          }}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600' }}>{disciplineName}</Text>
        {isLoading ? <Text style={{ color: '#5F6368', fontSize: 12 }}>Loading rank…</Text> : null}
        {isError ? <InlineError message={getApiErrorMessage(error, 'Could not load rank details.')} /> : null}
        {rank ? (
          <Text style={{ color: '#5F6368', fontSize: 12 }}>
            Rank {rank.order}
            {stripeTier ? ` · ${stripeTier.count} stripe${stripeTier.count === 1 ? '' : 's'}` : ''}
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

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>My Rank</Text>
      {ranksIsError ? (
        <InlineError message={getApiErrorMessage(ranksError, 'Failed to load your rank — please try again.')} />
      ) : (
        <>
          {disciplinesIsError ? (
            <InlineError message={getApiErrorMessage(disciplinesError, 'Could not load discipline names.')} />
          ) : null}
          {ranks.map((r) => (
            <MyRankRow key={r.id} studentRank={r} disciplineName={disciplineNameById.get(r.disciplineId) ?? 'Unknown discipline'} />
          ))}
        </>
      )}
    </View>
  );
}
