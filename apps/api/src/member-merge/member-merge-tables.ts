/**
 * Decision 315 item 13 ("merge duplicate members"): what a merge does with
 * each table that holds a member's id at a School. MemberMergeService runs
 * these, and the e2e spec checks every one; the PR body lists the same.
 *
 * Every statement is limited to one School and to the duplicate's id, so
 * nothing at another School and nothing about the person's login (the User
 * row, refresh tokens, devices, Guardian links, consents, their own
 * playlists) is ever touched.
 */

/** Moved as they are, by "studentId": every row of the duplicate's at this
 * School becomes the kept member's. In this order: a promotion-fee Charge is
 * checked against its request's member (Charge_promotion_fee_same_owner), so
 * the requests move before the charges. */
export const MOVED_BY_STUDENT_ID = [
  'Membership',
  'MembershipFreeze',
  'PackRecharge',
  'Transaction',
  'Booking',
  'WaitlistEntry',
  'StudentRank',
  'StudentRankSkillStatus',
  'PromotionEvent',
  'PromotionEventNoteLog',
  'SkillSignOffLog',
  'TrainingLog',
  'RankCorrectionRequest',
  'PromotionFeeRequest',
  'Charge',
  'ChargeAllocation',
  'BalanceEntry',
  'ChargeRefund',
  'RecurringCharge',
  'StudentNote',
  'MemberFile',
  'ChildInvite',
] as const;

/** Moved by "userId": a sign-up made or used the duplicate's account. */
export const MOVED_BY_USER_ID = ['SignUp'] as const;

/** One row per member and lesson (tag, roster, absence spell, custom
 * field): the duplicate's row moves unless the kept member already has one
 * for the same lesson (tag, roster, spell, field) at this School; then the
 * duplicate's copy is deleted. For a custom field (Decision 315 item 14)
 * that means the kept member's value wins when both have one. StudentAbsenceAlert only records that the absence alert for a
 * spell was sent (Decision 317 item 7), so moving it keeps a merged member
 * from being alerted twice for the same spell. */
export const MOVED_UNLESS_KEPT_HAS = [
  { table: 'Favorite', key: 'lessonId' },
  { table: 'WatchHistory', key: 'lessonId' },
  { table: 'StudentTag', key: 'tagId' },
  { table: 'RosterMember', key: 'rosterId' },
  { table: 'StudentAbsenceAlert', key: 'absentSince' },
  { table: 'CustomMemberFieldValue', key: 'fieldId' },
] as const;

/** One row per member at a School: the kept member's stays and the
 * duplicate's is deleted; the duplicate's moves when the kept member has
 * none. (StudentJoinDate keeps the earlier of the two dates, Decision 315
 * item 4: a join date is never in the future and staff only move it
 * earlier.) StudentCustomStatus (Decision 315 item 14): the kept member's
 * status if set, else the duplicate's. StudentMedicalInfo (Decision 315 item
 * 10): the kept member's medical information if they gave any, else the
 * duplicate's, with its consent (who gave it, when, and whether a Guardian
 * did); a duplicate who consented for themselves is shown as the kept member,
 * the same person. */
export const ONE_PER_SCHOOL = ['StudentHomeBranch', 'StudentCheckInCode', 'StudentJoinDate', 'StudentCustomStatus', 'StudentMedicalInfo'] as const;

export type MergeTable =
  | (typeof MOVED_BY_STUDENT_ID)[number]
  | (typeof MOVED_BY_USER_ID)[number]
  | (typeof MOVED_UNLESS_KEPT_HAS)[number]['table']
  | (typeof ONE_PER_SCHOOL)[number]
  | 'WaiverSignature';

/** Every table the merge counts, in the order the preview lists them. */
export const MERGE_TABLES: MergeTable[] = [
  ...MOVED_BY_STUDENT_ID,
  ...MOVED_BY_USER_ID,
  ...MOVED_UNLESS_KEPT_HAS.map((t) => t.table),
  ...ONE_PER_SCHOOL,
  'WaiverSignature',
];

/** Why two records can't be merged yet. The portal words each one. */
export const MERGE_BLOCKERS = [
  // A child's Guardians must be the same on both records (and an adult
  // can't be merged with a Guardian-managed child).
  'GUARDIANS_DIFFER',
  // Both have an unlimited membership (Membership_one_active_general_access_per_school).
  'BOTH_UNLIMITED_MEMBERSHIPS',
  // The duplicate pays by a running Stripe Subscription, whose Stripe
  // records name the duplicate's account.
  'DUPLICATE_HAS_SUBSCRIPTION',
  // A card payment is still in progress for either of them.
  'PENDING_CARD_PAYMENT',
  // The duplicate was offered a Class Pack at check-in and hasn't paid yet.
  'OPEN_PACK_RECHARGE',
  // Both have a belt in the same style; which history wins is a grading call.
  'SAME_STYLE_RANK',
  // Both asked for a belt correction in the same style.
  'SAME_STYLE_CORRECTION',
  // Both are booked into the same upcoming class.
  'SAME_CLASS_BOOKED',
  // Both are on the same class's waitlist.
  'SAME_CLASS_WAITLIST',
  // The duplicate's sign-up is still waiting for an answer.
  'OPEN_SIGN_UP',
  // The duplicate's Guardian hasn't answered an invite to add them yet.
  'PENDING_CHILD_INVITE',
] as const;
export type MergeBlockerCode = (typeof MERGE_BLOCKERS)[number];
