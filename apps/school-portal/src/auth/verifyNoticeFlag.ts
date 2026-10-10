/** "Show the belts-to-verify notice" (Decisions 137 item 4, 189): set on a
 * successful login, cleared once the notice is shown or found empty. Kept in
 * sessionStorage, like the token, so it lasts for this login only. */
const FLAG = 'ultm8.verifyBeltsNotice';

export function markVerifyNoticeDue() {
  try {
    sessionStorage.setItem(FLAG, '1');
  } catch {
    // Storage blocked: no notice this time; the Grading Board still shows "Not verified".
  }
}

export function isVerifyNoticeDue(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function clearVerifyNoticeDue() {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // nothing to clear
  }
}
