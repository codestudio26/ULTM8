import { common } from './en/common';
import { navigation } from './en/navigation';
import { home } from './en/home';
import { auth } from './en/auth';
import { academies } from './en/academies';
import { attendance } from './en/attendance';
import { bookings } from './en/bookings';
import { coach } from './en/coach';
import { curriculum } from './en/curriculum';
import { grading } from './en/grading';
import { guardians } from './en/guardians';
import { kidmode } from './en/kidmode';
import { memberships } from './en/memberships';
import { notifications } from './en/notifications';
import { payments } from './en/payments';
import { profile } from './en/profile';
import { ranks } from './en/ranks';
import { transactions } from './en/transactions';
import { waivers } from './en/waivers';
import { lib } from './en/lib';
import { serverKeys as server } from '@ultm8/i18n';

/**
 * English (UK) — the student app's source text (Decision 323), which every
 * other locale translates and which fills any key a locale leaves out. Grouped
 * by screen area; a Platform Admin Translation row overrides a key with the
 * screen `studentApp.<group>` (see I18nProvider).
 *
 * `{name}` is filled from the variables passed to `t()`; an object with
 * `one`/`other` (and, for Arabic etc., `zero`/`two`/`few`/`many`) is picked by
 * the `count` variable. `server` is the API's own text, shared with the portal.
 */
export const messages = {
  common,
  navigation,
  home,
  auth,
  academies,
  attendance,
  bookings,
  coach,
  curriculum,
  grading,
  guardians,
  kidmode,
  memberships,
  notifications,
  payments,
  profile,
  ranks,
  transactions,
  waivers,
  lib,
  server,
};

export type EnglishMessages = typeof messages;
