import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MergePreview = components['schemas']['MergePreviewDto'];
export type MergeBlocker = components['schemas']['MergeBlockerDto'];
export type MergeBlockerCode = components['schemas']['MergeBlockerCode'];
export type MergeRecordCounts = components['schemas']['MergeRecordCountsDto'];

/** What merging `duplicateId` into `keptId` would move, and anything that
 * stops it (Decision 315 item 13). School owners only. */
export function useMergePreview(schoolId: string | null, keptId: string, duplicateId: string | null) {
  return useQuery({
    queryKey: ['mergePreview', schoolId, keptId, duplicateId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/merge/preview', {
          params: { path: { schoolId: schoolId!, studentId: keptId }, query: { duplicateId: duplicateId! } },
        }),
      ),
    enabled: !!schoolId && !!duplicateId,
    retry: false,
  });
}

export function useMergeDuplicate(schoolId: string, keptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (duplicateId: string) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/merge', { params: { path: { schoolId, studentId: keptId } }, body: { duplicateId } })),
    // Nearly everything about both students changes: their lists, bookings,
    // memberships, charges, grading and the Students page.
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

/** The rows the preview counts, grouped the way the modal lists them. Each
 * table the API counts belongs to exactly one group. */
export const MERGE_GROUPS = {
  memberships: ['Membership', 'MembershipFreeze', 'PackRecharge'],
  payments: ['Transaction', 'Charge', 'ChargeAllocation', 'BalanceEntry', 'ChargeRefund', 'RecurringCharge', 'PromotionFeeRequest'],
  bookings: ['Booking', 'WaitlistEntry'],
  grading: ['StudentRank', 'StudentRankSkillStatus', 'PromotionEvent', 'PromotionEventNoteLog', 'SkillSignOffLog', 'TrainingLog', 'RankCorrectionRequest'],
  waivers: ['WaiverSignature'],
  notes: ['StudentNote'],
  tags: ['StudentTag'],
  customFields: ['CustomMemberFieldValue', 'StudentCustomStatus'],
  files: ['MemberFile'],
  more: ['ChildInvite', 'SignUp', 'Favorite', 'WatchHistory', 'RosterMember', 'StudentAbsenceAlert', 'StudentHomeBranch', 'StudentCheckInCode', 'StudentJoinDate', 'StudentMedicalInfo'],
} as const satisfies Record<string, ReadonlyArray<keyof MergeRecordCounts>>;
export type MergeGroup = keyof typeof MERGE_GROUPS;

export function mergeGroupCounts(records: MergeRecordCounts): Array<{ group: MergeGroup; count: number }> {
  return (Object.keys(MERGE_GROUPS) as MergeGroup[])
    .map((group) => ({ group, count: MERGE_GROUPS[group].reduce((sum, table) => sum + (records[table] ?? 0), 0) }))
    .filter((g) => g.count > 0);
}
