/**
 * Decision 420 item 2: who waives or cancels a promotion fee. The School
 * owner, or staff the owner has given "Can cancel charges" (the same switch
 * that cancels charges and waives late fees). The API checks it again, with
 * the student's branch; this only decides which buttons show.
 */

/** What GET /schools/{schoolId}/staff/me/access says about the switch. */
export type MyChargeAccess = { cancelCharges: boolean } | null | undefined;

/** The grading board panel and the student's grading card: Waive / Cancel. */
export function mayCloseFee(isOwner: boolean, access: MyChargeAccess): boolean {
  return isOwner || !!access?.cancelCharges;
}

/**
 * The student's Payments card: Waive fee / Cancel fee on a promotion fee's
 * own charge. Only an accepted fee has a charge still open (a paid one is
 * closed, a pending or declined one has no charge yet); `canCancel` is the
 * card's own "Can cancel charges" answer for this student.
 */
export function mayCloseFeeCharge(canCancel: boolean, fee: { status: string } | null | undefined): boolean {
  return canCancel && fee?.status === 'ACCEPTED';
}
