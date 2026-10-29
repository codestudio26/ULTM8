/** Backlog 3.13 (Decisions 286, 299): refusals for belt correction requests,
 * with codes the apps show in their own words. */
export const CORRECTION_NOT_VERIFIED = {
  code: 'CORRECTION_NOT_VERIFIED',
  message: 'Your belt in this style is still waiting to be checked by the School. They can correct it then.',
};
export const CORRECTION_PENDING = {
  code: 'CORRECTION_PENDING',
  message: 'You already asked for a correction in this style. Wait for the School to answer it.',
};
export const CORRECTION_SAME_RANK = {
  code: 'CORRECTION_SAME_RANK',
  message: 'That is the belt you already have. Pick the belt you should have.',
};
export const CORRECTION_STALE = {
  code: 'CORRECTION_STALE',
  message: "The student's belt changed since they asked, so this request no longer applies. Reject it; they can ask again.",
};
export const CORRECTION_RUNG_GONE = {
  code: 'CORRECTION_RUNG_GONE',
  message: 'The belt they asked for is no longer on the ladder. Reject the request.',
};
export const CORRECTION_ANSWERED = {
  code: 'CORRECTION_ANSWERED',
  message: 'This request has already been answered.',
};

/** The student's note: required, up to this many characters. */
export const CORRECTION_NOTE_MAX = 500;
