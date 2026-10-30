import type { MessageVars } from '../types';
import { SERVER_PATTERNS } from './en';

/**
 * Translates the English text the API sends — error messages and the titles and
 * bodies its background jobs write into Notifications — for a non-English
 * screen (Decision 273). English screens never call this; they show the API's
 * own text unchanged.
 *
 * Errors, in order: a message the server builds from counts, lists or fixed
 * English words (`ERROR_RULES`, translated through the `server.errors` keys) →
 * an exact match in the locale's map → a map entry followed by server-filled
 * text (ids after "…: ") → a `{v1}` pattern → a generic message for the HTTP
 * status. So a message nobody has translated yet still never shows in English.
 *
 * Notifications only translate the shapes the API's own jobs write; anything
 * else — a School's broadcast, which a person wrote — is shown as written.
 */

type Translate = (key: string, vars?: MessageVars) => string;
type Rule = (m: RegExpMatchArray, ctx: Context) => string | null;

interface Context {
  t: Translate;
  locale: string;
}

export const SERVER_MESSAGE_LOADERS: Record<string, () => Promise<Record<string, string>>> = {
  'pt-BR': () => import('./pt-BR').then((m) => m.serverMessages),
  es: () => import('./es').then((m) => m.serverMessages),
  ar: () => import('./ar').then((m) => m.serverMessages),
  fr: () => import('./fr').then((m) => m.serverMessages),
  de: () => import('./de').then((m) => m.serverMessages),
  it: () => import('./it').then((m) => m.serverMessages),
  nl: () => import('./nl').then((m) => m.serverMessages),
  pl: () => import('./pl').then((m) => m.serverMessages),
  ru: () => import('./ru').then((m) => m.serverMessages),
  tr: () => import('./tr').then((m) => m.serverMessages),
  ja: () => import('./ja').then((m) => m.serverMessages),
  ko: () => import('./ko').then((m) => m.serverMessages),
  'zh-CN': () => import('./zh-CN').then((m) => m.serverMessages),
  th: () => import('./th').then((m) => m.serverMessages),
};

const count = (s: string) => Number(s);
const verb = (action: string) => (action === 'archived' ? 'Archive' : 'Delete');

/** One counted phrase of an archive-blocker list the API joins with ", " / " and ". */
const LIST_ITEMS: Array<[RegExp, string]> = [
  [/^(\d+) upcoming bookings?$/, 'upcomingBookings'],
  [/^(\d+) students? on its waitlist$/, 'waitlistStudents'],
  [/^(\d+) Class(?:es)?$/, 'classes'],
  [/^(\d+) Instructor profiles?$/, 'instructorProfiles'],
  [/^(\d+) Students? with this as their home branch$/, 'homeStudents'],
  [/^(\d+) active staff\/instructor role grants? scoped to it$/, 'roleGrants'],
  [/^(\d+) upcoming Class(?:es)?$/, 'upcomingClasses'],
  [/^(\d+) active TimetableSlots?$/, 'activeSlots'],
  [/^(\d+) weekly timetable slots?$/, 'weeklySlots'],
];

function translateList(list: string, { t, locale }: Context): string | null {
  const parts = list.split(/, | and /).map((part) => {
    for (const [re, key] of LIST_ITEMS) {
      const m = part.match(re);
      if (m) return t(`server.errors.items.${key}`, { count: count(m[1]) });
    }
    return null;
  });
  if (parts.some((p) => p === null)) return null;
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(parts as string[]);
}

/** apps/api's TOGGLE_LABELS (ranks/grading.service.ts) → the portal's own toggle names. */
const TOGGLES: Record<string, string> = {
  Promote: 'canPromote',
  'Move down': 'canDowngrade',
  'Sign off skills': 'canSignOffSkills',
  'Adjust progress': 'canAdjustProgress',
  'Verify self-declared ranks': 'canVerifyRanks',
  'Void history entries': 'canVoidHistory',
  'Change board %': 'canChangeBoardThresholds',
};

const ERROR_RULES: Array<[RegExp, Rule]> = [
  [
    /^This TimetableSlot can't be archived while it still has (\d+) upcoming bookings? against its generated Classes\.$/,
    (m, { t }) => t('server.errors.slotHasBookings', { count: count(m[1]) }),
  ],
  [
    /^This Waiver can't be archived while it has (\d+) signatures?\/assignment records? against it \(legal records\)\. It can still be edited in place if needed\.$/,
    (m, { t }) => t('server.errors.waiverHasSignatures', { count: count(m[1]) }),
  ],
  [
    /^(\d+) students? (?:has|have) a rank in this style, so it can't be deleted\.$/,
    (m, { t }) => t('server.errors.styleHasStudents', { count: count(m[1]) }),
  ],
  [
    /^(\d+) students? (?:holds|hold) this belt, so it can't be (deleted|archived)\.$/,
    (m, { t }) => t(`server.errors.beltHeld${verb(m[2])}`, { count: count(m[1]) }),
  ],
  [
    /^This belt is in students' grading history, so it can't be (deleted|archived)\.$/,
    (m, { t }) => t(`server.errors.beltInHistory${verb(m[1])}`),
  ],
  [
    /^An instructor has declared this belt, so it can't be (deleted|archived)\.$/,
    (m, { t }) => t(`server.errors.beltDeclared${verb(m[1])}`),
  ],
  [
    /^This Class can't be archived while it still has (.+)\.$/,
    (m, ctx) => withItems(ctx, 'classHasDependents', translateList(m[1], ctx)),
  ],
  [
    /^This Branch can't be closed while it still has (.+)\. Choose where they go, or move them first\.$/,
    (m, ctx) => withItems(ctx, 'branchHasDependents', translateList(m[1], ctx)),
  ],
  [
    /^This Instructor can't be archived while they're assigned to (.+)\. Reassign them first\.$/,
    (m, ctx) => withItems(ctx, 'instructorHasDependents', translateList(m[1], ctx)),
  ],
  [
    /^This (School|Franchise) already has an active platform subscription — plan changes are not supported yet\.$/,
    (m, { t }) => t(`server.errors.${m[1].toLowerCase()}HasSubscription`),
  ],
  [
    /^This (School|Franchise) has no active platform subscription to cancel\.$/,
    (m, { t }) => t(`server.errors.${m[1].toLowerCase()}NoSubscription`),
  ],
  [
    /^This Student hasn't reached a rank that unlocks (.+) · (.+) classes\.( A Staff member can override this per-Booking\.)?$/,
    (m, { t }) => {
      const text =
        m[1] === 'this style'
          ? t('server.errors.rankLockedAnyStyle', { classType: m[2] })
          : t('server.errors.rankLocked', { style: m[1], classType: m[2] });
      return m[3] ? `${text} ${t('server.errors.rankLockedStaffOverride')}` : text;
    },
  ],
  [
    /^Your grading permission for this style doesn't include this: (.+)\. The School owner can turn it on\.$/,
    (m, { t }) =>
      TOGGLES[m[1]]
        ? t('server.errors.gradingPermissionMissing', { toggle: t(`grading.permissions.toggles.${TOGGLES[m[1]]}.label`) })
        : null,
  ],
];

function withItems({ t }: Context, key: string, items: string | null): string | null {
  return items === null ? null : t(`server.errors.${key}`, { items });
}

function genericKey(status: number): string {
  if (status === 0) return 'network';
  if (status === 400) return 'badRequest';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 413) return 'tooLarge';
  if (status === 422) return 'validation';
  if (status === 429) return 'tooManyRequests';
  if (status >= 500) return 'serverError';
  return 'unexpected';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `{v1}`-style English patterns, compiled once per locale map. */
function compilePatterns(map: Record<string, string>): Array<{ re: RegExp; template: string }> {
  return SERVER_PATTERNS.filter((p) => map[p]).map((p) => ({
    re: new RegExp(`^${escapeRegExp(p).replace(/\\\{v(\d+)\\\}/g, '(?<v$1>[\\s\\S]*?)')}$`),
    template: map[p],
  }));
}

function applyRules(rules: Array<[RegExp, Rule]>, text: string, ctx: Context): string | null {
  for (const [re, rule] of rules) {
    const m = text.match(re);
    if (m) {
      const out = rule(m, ctx);
      if (out !== null) return out;
    }
  }
  return null;
}

function formatAmount(value: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

/** A YYYY-MM-DD calendar day in the reader's language (Decision 404's freeze notices). */
function formatDay(day: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00.000Z`));
  } catch {
    return day;
  }
}

const NOTIFICATION_TITLES: Record<string, string> = {
  'A spot opened up': 'spotOpenedTitle',
  'Ready to grade': 'readyToGradeTitle',
  'Student payment-restricted': 'paymentRestrictedTitle',
  'Waiver signature requested': 'waiverRequestTitle',
  'Waiver reminder': 'waiverReminderTitle',
  'Waiver updated': 'waiverUpdatedTitle',
  'Waiver renewal': 'waiverRenewalTitle',
  'New stripe!': 'newStripeTitle',
  'Step up!': 'stepUpTitle',
  'Promoted!': 'promotedTitle',
  'Rank updated': 'rankUpdatedTitle',
  'Payment dispute lost': 'disputeLostTitle',
  'Payment dispute resolved': 'disputeResolvedTitle',
  'Payment dispute opened': 'disputeOpenedTitle',
  'Cancellations to resolve': 'cancellationsTitle',
  'Cash payment waiting': 'cashWaitingTitle',
  'Payment confirmed': 'paymentConfirmedTitle',
  'Payment cancelled': 'paymentCancelledTitle',
  // Decision 404 — apps/api/src/memberships/freeze/membership-freezes.service.ts.
  'Freeze approved': 'freezeApprovedTitle',
  'Freeze declined': 'freezeDeclinedTitle',
  // Decisions 303, 338 — apps/api/src/charges/charges.service.ts.
  'New invoice': 'chargeCreatedTitle',
  'Payment received': 'chargePaymentTitle',
  'Charge cancelled': 'chargeCancelledTitle',
  // Decision 409 — MembershipFreezesService.notifyBookingsCancelled.
  'Bookings cancelled': 'freezeBookingsCancelledTitle',
  'Automatic payment failed': 'chargeAutoPayFailedTitle',
  'Class moved': 'classMovedTitle',
  'Class cancelled': 'classCancelledTitle',
  'Promotion to decide': 'toDecideTitle',
  'Promotion fee': 'promotionFeeTitle',
  // Decision 364 — apps/api/src/tenants/franchises/franchise-notifications.ts.
  'School asking to join': 'joinAskedTitle',
  'Joined the Franchise': 'joinAcceptedTitle',
  'Request to join declined': 'joinDeclinedTitle',
  'Removed from the Franchise': 'removedFromFranchiseTitle',
  'Franchise closed': 'franchiseClosedTitle',
  // Decision 371 — apps/api/src/tenants/schools/student-added-notice.ts.
  'Added to a School': 'studentAddedTitle',
  // Decision 386 — apps/api/src/open-mats/open-mats.service.ts.
  'Open mat': 'openMatTitle',
  // Decision 407 — apps/api/src/jobs/stripe-webhook-processing.processor.ts.
  'Franchise fee payment failed': 'franchiseFeeFailedTitle',
};

const CHARGES: Record<string, string> = {
  'Membership payment': 'membershipPayment',
  'franchise fee charge': 'franchiseFeeCharge',
};
const DISPUTE_STATUSES = new Set([
  'warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented',
]);

const n = (t: Translate, key: string, vars?: MessageVars) => t(`server.notifications.${key}`, vars);
const charge = (t: Translate, label: string) => n(t, CHARGES[label]);

/** The style name a grading body ends with in brackets. It may hold brackets of
 * its own ("Judo (Kids)"), so it is matched as text plus whole bracket pairs —
 * a plain `(.+)` would cut it at the inner "(" and show "Kids)". */
const STYLE = String.raw`((?:[^()]|\([^()]*\))+)`;
const body = (source: string) => new RegExp(source, 's');

/** apps/api/src/jobs/*.processor.ts — every Notification body a job writes. */
const BODY_RULES: Array<[RegExp, Rule]> = [
  // Decision 291 — CancellationService (apps/api/src/bookings/cancellation.service.ts).
  [
    /^(.+) on (.+?) has been cancelled by the school\. Reason: (.+)$/s,
    (m, { t }) => n(t, 'classCancelledBySchoolBodyWithReason', { class: m[1], when: m[2], reason: m[3] }),
  ],
  [/^(.+) on (.+?) has been cancelled by the school\.$/s, (m, { t }) => n(t, 'classCancelledBySchoolBody', { class: m[1], when: m[2] })],
  [
    /^A cancelled booking needs a refund decision or a cash refund paid\. See Cancellations to resolve\.$/,
    (_m, { t }) => n(t, 'cancellationReviewBody'),
  ],
  [
    /^Bookings from the cancelled class (.+) need a refund decision or a cash refund paid \((\d+)\)\. See Cancellations to resolve\.$/s,
    (m, { t }) => n(t, 'cancellationClassReviewBody', { class: m[1], count: Number(m[2]) }),
  ],
  [
    /^A spot opened up in (.+)\. Claim it soon — it goes to the next person on the waitlist if you don't\.$/s,
    (m, { t }) => n(t, 'spotOpenedBody', { class: m[1] }),
  ],
  [
    body(String.raw`^(.+) is ready for their next rank \(${STYLE}\)\.$`),
    (m, { t }) => n(t, 'readyToGradeBodyNextRank', { name: m[1], style: m[2] }),
  ],
  [body(String.raw`^(.+) is ready for (.+) \(${STYLE}\)\.$`), (m, { t }) => n(t, 'readyToGradeBody', { name: m[1], rank: m[2], style: m[3] })],
  [
    /^(.+), a Student at your School, has been restricted to Cash\/Bank Transfer payment methods only, following a pattern of lost Stripe disputes\.$/s,
    (m, { t }) => n(t, 'paymentRestrictedNamedBody', { name: m[1] }),
  ],
  // Older rows, written before the Student was named.
  [
    /^A Student at your School has been restricted to Cash\/Bank Transfer payment methods only, following a pattern of lost Stripe disputes\.$/,
    (_m, { t }) => n(t, 'paymentRestrictedBody'),
  ],
  [/^(.+) has invited you to sign the waiver "(.+)"\.$/s, (m, { t }) => n(t, 'waiverRequestFromSchoolBody', { school: m[1], waiver: m[2] })],
  // Decision 354 — apps/api/src/jobs/waiver-signature-requests.processor.ts waiverNotice().
  [/^(.+) reminds you to sign the waiver "(.+)"\.$/s, (m, { t }) => n(t, 'waiverReminderBody', { school: m[1], waiver: m[2] })],
  [
    /^(.+) has updated the waiver "(.+)"\. Please read it and sign it again\.$/s,
    (m, { t }) => n(t, 'waiverUpdatedBody', { school: m[1], waiver: m[2] }),
  ],
  [
    /^Your signature on the waiver "(.+)" at (.+) has run out\. Please sign it again\.$/s,
    (m, { t }) => n(t, 'waiverRenewalBody', { waiver: m[1], school: m[2] }),
  ],
  [/^You're now 18, so (.+) asks you to sign the waiver "(.+)" yourself\.$/s, (m, { t }) => n(t, 'waiverAdultBody', { school: m[1], waiver: m[2] })],
  // Older rows, written before the School was named (the waiver's title sat
  // where the sender belongs).
  [/^(.+) has invited you to sign the following waiver\.$/s, (m, { t }) => n(t, 'waiverRequestBody', { waiver: m[1] })],
  // apps/api/src/timetable/timetable.service.ts — "Your booking moved with it." is
  // the wording before the waitlist was told too.
  [/^(.+) has moved to (.+)\. (?:Bookings|Your booking) moved with it\.$/s, (m, { t }) => n(t, 'classMovedBody', { class: m[1], when: m[2] })],
  [/^(.+) has moved to (.+)\. Your waitlist place moved with it\.$/s, (m, { t }) => n(t, 'classMovedWaitlistBody', { class: m[1], when: m[2] })],
  [
    /^(.+) on (.+) was cancelled by your School\. Any class credit you used has been given back\.$/s,
    (m, { t }) => n(t, 'classCancelledBody', { class: m[1], when: m[2] }),
  ],
  // Decision 364 — apps/api/src/tenants/franchises/franchise-notifications.ts.
  [/^(.+) has asked to join (.+)\.$/s, (m, { t }) => n(t, 'joinAskedBody', { school: m[1], franchise: m[2] })],
  [/^(.+) accepted (.+)'s request to join\.$/s, (m, { t }) => n(t, 'joinAcceptedBody', { franchise: m[1], school: m[2] })],
  [/^(.+) declined (.+)'s request to join\. You can ask again\.$/s, (m, { t }) => n(t, 'joinDeclinedBody', { franchise: m[1], school: m[2] })],
  [
    /^(.+) removed (.+) from the Franchise\. Its franchise fees have stopped\.$/s,
    (m, { t }) => n(t, 'removedFromFranchiseBody', { franchise: m[1], school: m[2] }),
  ],
  [
    /^(.+) has been closed\. (.+) stays open, and its franchise fees have stopped\.$/s,
    (m, { t }) => n(t, 'franchiseClosedBody', { franchise: m[1], school: m[2] }),
  ],
  // Decision 371 — apps/api/src/tenants/schools/student-added-notice.ts.
  [/^You've been added to (.+)\.$/s, (m, { t }) => n(t, 'studentAddedBody', { school: m[1] })],
  // Decision 386 — apps/api/src/open-mats/open-mats.service.ts.
  [
    /^Open mat \((.+)\) at (.+) on (.+), for (\d+) minutes\. Book in the app to join\.$/s,
    (m, { t }) => n(t, 'openMatStyleBody', { style: m[1], place: m[2], when: m[3], minutes: m[4] }),
  ],
  [/^Open mat at (.+) on (.+), for (\d+) minutes\. Book in the app to join\.$/s, (m, { t }) => n(t, 'openMatBody', { place: m[1], when: m[2], minutes: m[3] })],
  [
    body(String.raw`^(.+)'s promotion to (.+) \(${STYLE}\) is waiting for your decision\. Promote them, or decide not to\.$`),
    (m, { t }) => n(t, 'toDecideBody', { name: m[1], rank: m[2], style: m[3] }),
  ],
  [
    body(String.raw`^Your promotion to (.+) \(${STYLE}\) has a fee of (.+)\. Open the app to accept or decline it\.$`),
    (m, { t }) => n(t, 'promotionFeeBody', { rank: m[1], style: m[2], amount: m[3] }),
  ],
  [
    body(String.raw`^(.+)'s promotion to (.+) \(${STYLE}\) has a fee of (.+)\. Open the app to accept or decline it\.$`),
    (m, { t }) => n(t, 'childPromotionFeeBody', { name: m[1], rank: m[2], style: m[3], amount: m[4] }),
  ],
  [body(String.raw`^You've earned (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'youEarned', { rank: m[1], style: m[2] })],
  [body(String.raw`^You've been promoted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'youPromoted', { rank: m[1], style: m[2] })],
  [body(String.raw`^Your rank has been adjusted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'youAdjusted', { rank: m[1], style: m[2] })],
  [body(String.raw`^Your child has earned (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'yourChildEarned', { rank: m[1], style: m[2] })],
  [body(String.raw`^Your child has been promoted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'yourChildPromoted', { rank: m[1], style: m[2] })],
  [body(String.raw`^Your child's rank has been adjusted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'yourChildAdjusted', { rank: m[1], style: m[2] })],
  [body(String.raw`^(.+) has earned (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'childEarned', { name: m[1], rank: m[2], style: m[3] })],
  [body(String.raw`^(.+) has been promoted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'childPromoted', { name: m[1], rank: m[2], style: m[3] })],
  [body(String.raw`^(.+)'s rank has been adjusted to (.+)\. \(${STYLE}\)$`), (m, { t }) => n(t, 'childAdjusted', { name: m[1], rank: m[2], style: m[3] })],
  [
    /^A disputed (Membership payment|franchise fee charge) of ([\d.]+) ([A-Z]{3}) was lost — the charge is no longer considered paid\.$/,
    (m, { t, locale }) => n(t, 'disputeLostBody', { charge: charge(t, m[1]), amount: formatAmount(m[2], m[3], locale) }),
  ],
  [
    /^A disputed (Membership payment|franchise fee charge) of ([\d.]+) ([A-Z]{3}) was resolved in your favor\.$/,
    (m, { t, locale }) => n(t, 'disputeResolvedBody', { charge: charge(t, m[1]), amount: formatAmount(m[2], m[3], locale) }),
  ],
  [
    /^A (Membership payment|franchise fee charge) of ([\d.]+) ([A-Z]{3}) has been disputed by the payer \(status: (\w+)\)\.$/,
    (m, { t, locale }) =>
      n(t, 'disputeOpenedBody', {
        charge: charge(t, m[1]),
        amount: formatAmount(m[2], m[3], locale),
        status: DISPUTE_STATUSES.has(m[4]) ? n(t, `disputeStatus.${m[4]}`) : m[4],
      }),
  ],  // PaymentsService.notifyCashPayment — Cash/Bank Transfer payments (Decision 339, T11).
  [
    /^(.+) chose to pay ([\d.]+) ([A-Z]{3}) for (.+) by cash or bank transfer\. Mark it as paid on the Transactions page once the money arrives\.$/s,
    (m, { t, locale }) => n(t, 'cashWaitingBody', { name: m[1], amount: formatAmount(m[2], m[3], locale), plan: m[4] }),
  ],
  [
    /^Your payment of ([\d.]+) ([A-Z]{3}) for (.+) was confirmed\. Your membership is now active\.$/s,
    (m, { t, locale }) => n(t, 'paymentConfirmedBody', { amount: formatAmount(m[1], m[2], locale), plan: m[3] }),
  ],
  [
    /^(.+?)'s payment of ([\d.]+) ([A-Z]{3}) for (.+) was confirmed\. The membership is now active\.$/s,
    (m, { t, locale }) => n(t, 'childPaymentConfirmedBody', { name: m[1], amount: formatAmount(m[2], m[3], locale), plan: m[4] }),
  ],
  [
    /^Your School cancelled your cash or bank payment of ([\d.]+) ([A-Z]{3}) for (.+)\.$/s,
    (m, { t, locale }) => n(t, 'paymentCancelledBody', { amount: formatAmount(m[1], m[2], locale), plan: m[3] }),
  ],
  [
    /^The School cancelled (.+?)'s cash or bank payment of ([\d.]+) ([A-Z]{3}) for (.+)\.$/s,
    (m, { t, locale }) => n(t, 'childPaymentCancelledBody', { name: m[1], amount: formatAmount(m[2], m[3], locale), plan: m[4] }),
  ],
  // Decision 404 — MembershipFreezesService.notifyDecision. Dates are YYYY-MM-DD.
  [
    /^Your (.+) membership is frozen from (\d{4}-\d{2}-\d{2})\. You're back on (\d{4}-\d{2}-\d{2})\.$/s,
    (m, { t, locale }) => n(t, 'freezeApprovedBody', { plan: m[1], start: formatDay(m[2], locale), back: formatDay(m[3], locale) }),
  ],
  [
    /^Your School declined your request to freeze (.+) from (\d{4}-\d{2}-\d{2})\.$/s,
    (m, { t, locale }) => n(t, 'freezeDeclinedBody', { plan: m[1], start: formatDay(m[2], locale) }),
  ],
  // Decisions 303, 338 — ChargesService. Amounts are "120.00 BRL"; days are YYYY-MM-DD.
  [
    /^Invoice (#\d+) for (.+): ([\d.]+) ([A-Z]{3}), due (\d{4}-\d{2}-\d{2})\.$/s,
    (m, { t, locale }) => n(t, 'chargeCreatedBody', { invoice: m[1], description: m[2], amount: formatAmount(m[3], m[4], locale), due: formatDay(m[5], locale) }),
  ],
  [/^Your payment of ([\d.]+) ([A-Z]{3}) was received\.$/s, (m, { t, locale }) => n(t, 'chargePaymentBody', { amount: formatAmount(m[1], m[2], locale) })],
  [
    /^We couldn't charge your saved card for invoice (#\d+) \((.+), ([\d.]+) ([A-Z]{3})\)\. Pay it in the app or at the front desk\.$/s,
    (m, { t, locale }) => n(t, 'chargeAutoPayFailedBody', { invoice: m[1], description: m[2], amount: formatAmount(m[3], m[4], locale) }),
  ],
  [
    /^Your charge '(.+), ([\d.]+) ([A-Z]{3})' was cancelled\. Nothing to pay\. The ([\d.]+) ([A-Z]{3}) already paid is now credit on your balance\.$/s,
    (m, { t, locale }) =>
      n(t, 'chargeCancelledCreditBody', { description: m[1], amount: formatAmount(m[2], m[3], locale), paid: formatAmount(m[4], m[5], locale) }),
  ],
  [
    /^Your charge '(.+), ([\d.]+) ([A-Z]{3})' was cancelled\. Nothing to pay\.$/s,
    (m, { t, locale }) => n(t, 'chargeCancelledBody', { description: m[1], amount: formatAmount(m[2], m[3], locale) }),
  ],
  // Decision 409 — MembershipFreezesService.notifyBookingsCancelled. The list
  // is "Class title (YYYY-MM-DD)" joined with "; ", maybe ending "; +N"; only
  // its dates are translated (class titles are the School's own words).
  [
    /^Your (.+) membership is frozen from (\d{4}-\d{2}-\d{2}) and you're back on (\d{4}-\d{2}-\d{2}), so your bookings in between were cancelled: (.+)\. You can book again once the freeze ends\.$/s,
    (m, { t, locale }) =>
      n(t, 'freezeBookingsCancelledBody', {
        plan: m[1],
        start: formatDay(m[2], locale),
        back: formatDay(m[3], locale),
        list: m[4].replace(/\((\d{4}-\d{2}-\d{2})\)/g, (_d, day: string) => `(${formatDay(day, locale)})`),
      }),
  ],
  // Decision 407 — StripeWebhookProcessingProcessor.franchiseFeeFailedNotices.
  [
    /^The franchise fee of ([\d.]+) ([A-Z]{3}) for (.+) couldn't be charged\. Stripe will try again\. Add or update the card on the School page\.$/s,
    (m, { t, locale }) => n(t, 'franchiseFeeFailedBody', { amount: formatAmount(m[1], m[2], locale), school: m[3] }),
  ],
];

export interface ServerTextTranslator {
  error: (status: number, code: string, message: string) => string | Promise<string>;
  notification: (n: { title: string; body: string; type?: string | null }) => { title: string; body: string };
}

interface CompiledMap {
  messages: Record<string, string>;
  patterns: Array<{ re: RegExp; template: string }>;
  prefixes: string[];
}

const compiled = new WeakMap<Record<string, string>, CompiledMap>();

function compile(messages: Record<string, string>): CompiledMap {
  let c = compiled.get(messages);
  if (!c) {
    c = {
      messages,
      patterns: compilePatterns(messages),
      // Entries the server appends its own text to ("…Not signed off yet: " + ids), or
      // one sentence the extraction split in two where the API joins two literals.
      prefixes: Object.keys(messages).filter((k) => /\s$/.test(k)),
    };
    compiled.set(messages, c);
  }
  return c;
}

function known({ messages, patterns, prefixes }: CompiledMap, message: string): string | null {
  if (messages[message]) return messages[message];
  for (const prefix of prefixes) {
    if (!message.startsWith(prefix)) continue;
    const rest = message.slice(prefix.length);
    return messages[prefix] + (messages[rest] ?? rest);
  }
  for (const { re, template } of patterns) {
    const m = message.match(re);
    if (m?.groups) {
      const groups = m.groups;
      return template.replace(/\{v(\d+)\}/g, (_, i: string) => groups[`v${i}`] ?? '');
    }
  }
  return null;
}

/** `loadMessages` is the locale's map loader: awaited per error, so an error that
 * arrives before the map has downloaded still gets its specific translation rather
 * than the generic one (the module is fetched once and then served from cache). */
export function createServerTextTranslator(
  t: Translate,
  locale: string,
  loadMessages: (() => Promise<Record<string, string>>) | undefined,
): ServerTextTranslator {
  const ctx: Context = { t, locale };

  return {
    async error(status, _code, message) {
      const ruled = applyRules(ERROR_RULES, message, ctx);
      if (ruled !== null) return ruled;
      // A map that fails to load (e.g. a stale chunk after a deploy) still leaves
      // the generic message below, never the English.
      const messages = loadMessages ? await loadMessages().catch(() => ({})) : {};
      return known(compile(messages), message) ?? t(`server.generic.${genericKey(status)}`);
    },
    notification({ title, body, type }) {
      // A parent's copy of their child's notification (NotificationFanoutProcessor):
      // the child's message, translated as usual, behind "For {name}: ".
      const forChild = body.match(/^For ([^:]+): (.*)$/s);
      const inner = forChild ? forChild[2] : body;
      const wrap = (text: string) => (forChild ? n(t, 'forChild', { name: forChild[1], body: text }) : text);
      // A broadcast's text is the School's own words, never a template.
      if (type === 'SCHOOL_BROADCAST') return { title, body: wrap(inner) };
      const titleKey = NOTIFICATION_TITLES[title];
      return {
        title: titleKey ? n(t, titleKey) : title,
        body: wrap(applyRules(BODY_RULES, inner, ctx) ?? inner),
      };
    },
  };
}
