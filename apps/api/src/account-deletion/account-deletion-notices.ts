/**
 * The English text of "Delete my account"'s notices (rule 6). The
 * Notification rows are translated in the apps by their shape
 * (@ultm8/i18n server/translate.ts); the final email goes out in English,
 * like every other email the API sends today.
 */

/** Machine form, formatted for the reader by the apps (Decision 434, TXT-3), in
 * their own time zone (Decision 441 item 9). */
export function noticeWhen(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export const DELETION_REQUESTED_TITLE = 'Account deletion requested';

/** To the member, when they ask. `children`: the children deleted with them. */
export function deletionRequestedNotice(dueAt: Date, children: string[]) {
  const withChildren = children.length > 0 ? ` These children's accounts will be deleted with it: ${children.join(', ')}.` : '';
  return {
    title: DELETION_REQUESTED_TITLE,
    body: `Your ULTM8 account will be deleted on ${noticeWhen(dueAt)}. Until then it is locked.${withChildren} To keep it, sign in again before then.`,
  };
}

/** To the member, by email only, once the deletion is final. */
export const deletionFinalEmail = {
  subject: 'Your ULTM8 account has been deleted',
  body: [
    'Your ULTM8 account has now been deleted.',
    '',
    'Your name, email, phone number, date of birth, photo, passcode and medical notes have been removed for good.',
    'Your Schools keep their records of your payments, signed waivers, contracts and belt history, without your name. They are deleted when their usual keeping period ends.',
    '',
    'You can make a new account at any time.',
  ].join('\n'),
};

export const MEMBER_LEFT_TITLE = 'A member left';

/** To each School's owners, once the deletion is final. */
export const memberLeftNotice = {
  title: MEMBER_LEFT_TITLE,
  body: 'A member deleted their ULTM8 account and left your School. Their details have been removed. Their payments, waivers and belt history stay with your School under "Erased User".',
};
