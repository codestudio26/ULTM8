/**
 * Which parts of the front desk have their backend yet. Each switch is off
 * until its endpoint ships; the screen for it is built and shows a calm "Soon"
 * state meanwhile, so nothing pretends to work. Turning one on is the backend
 * team's last step for that item: see docs/handover/FRONT-DESK-BACKEND-HANDOVER.md,
 * which names the endpoint each switch waits for.
 */
export const FRONT_DESK_BACKEND = {
  /** Personal check-in code, 4 or 6 digits (Decision 315, v1.3 backlog §3.2).
   * Built 28 Oct 2026 (Decision 384). */
  personalCode: true,
  /** Locked front-desk session tied to one Branch, left with a staff code
   * (Decisions 317, 320, 351; §3.21). Built 28 Oct 2026 (Decision 380):
   * /front-desk starts it and /front-desk/kiosk is the tablet. */
  kioskSession: true,
  /** One student's waiver status for the welcome card (GET /students/{id}/waiver-status, built 28 Oct 2026). */
  waiverStatus: true,
  /** Sign-ups from the tablet waiting for staff approval (Decisions 318, 351). */
  signUp: false,
  /** "Find me" on the tablet (Decisions 351, 362). Built 28 Oct 2026 (Decision 385). */
  findMe: true,
  /** Start an unplanned open mat (Decision 304). */
  openMat: false,
} as const;

export type FrontDeskFeature = keyof typeof FRONT_DESK_BACKEND;

export function hasBackend(feature: FrontDeskFeature): boolean {
  return FRONT_DESK_BACKEND[feature];
}
