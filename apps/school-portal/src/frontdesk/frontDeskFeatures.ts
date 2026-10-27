/**
 * Which parts of the front desk have their backend yet. Each switch is off
 * until its endpoint ships; the screen for it is built and shows a calm "Soon"
 * state meanwhile, so nothing pretends to work. Turning one on is the backend
 * team's last step for that item: see docs/handover/FRONT-DESK-BACKEND-HANDOVER.md,
 * which names the endpoint each switch waits for.
 */
export const FRONT_DESK_BACKEND = {
  /** Personal 4-digit check-in code (Decision 315, v1.3 backlog §3.2). */
  personalCode: false,
  /** Locked front-desk session tied to one Branch, left with a staff code
   * (Decisions 317, 320, 351; §3.21). Until then front-desk mode runs in the
   * staff member's own login and isn't locked. */
  kioskSession: false,
  /** One student's waiver status for the welcome card. */
  waiverStatus: false,
  /** Sign-ups from the tablet waiting for staff approval (Decisions 318, 351). */
  signUp: false,
  /** "Find me" on the tablet (Decision 351). */
  findMe: false,
  /** Start an unplanned open mat (Decision 304). */
  openMat: false,
} as const;

export type FrontDeskFeature = keyof typeof FRONT_DESK_BACKEND;

export function hasBackend(feature: FrontDeskFeature): boolean {
  return FRONT_DESK_BACKEND[feature];
}
