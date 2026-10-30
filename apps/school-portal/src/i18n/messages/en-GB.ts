import { common } from './en/common';
import { layout } from './en/layout';
import { notifications } from './en/notifications';
import { auth } from './en/auth';
import { schools } from './en/schools';
import { branches } from './en/branches';
import { transactions } from './en/transactions';
import { cancellations } from './en/cancellations';
import { lib } from './en/lib';
import { dashboard } from './en/dashboard';
import { students } from './en/students';
import { instructors } from './en/instructors';
import { coach } from './en/coach';
import { grading } from './en/grading';
import { skills } from './en/skills';
import { timetable } from './en/timetable';
import { classes } from './en/classes';
import { attendance } from './en/attendance';
import { waivers } from './en/waivers';
import { membershipPlans } from './en/membershipPlans';
import { ranks } from './en/ranks';
import { curriculum } from './en/curriculum';
import { franchises } from './en/franchises';
import { roleGrants } from './en/roleGrants';
import { disciplines } from './en/disciplines';
import { ui } from './en/ui';
import { serverKeys as server } from '@ultm8/i18n';
import { profile } from './en/profile';
import { address } from './en/address';
import { frontDesk } from './en/frontDesk';
import { charges } from './en/charges';

/**
 * English (UK) — the source catalogue every other locale translates, and the
 * fallback for any key a locale leaves out. Grouped by screen; the group name
 * is the `screen` a Platform Admin Translation row uses to override a key.
 *
 * `{name}` is filled from the variables passed to `t()`; an object with
 * `one`/`other` (and, for Arabic etc., `zero`/`two`/`few`/`many`) is picked by
 * the `count` variable.
 */
export const messages = {
  common,
  layout,
  notifications,
  auth,
  schools,
  branches,
  transactions,
  cancellations,
  lib,
  dashboard,
  students,
  instructors,
  coach,
  grading,
  skills,
  timetable,
  classes,
  attendance,
  waivers,
  membershipPlans,
  ranks,
  curriculum,
  franchises,
  roleGrants,
  disciplines,
  ui,
  server,
  profile,
  address,
  frontDesk,
  charges,
};

export type EnglishMessages = typeof messages;
