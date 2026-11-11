/**
 * The new look's side menu (DESIGN-BRIEF §4–§5 Q1 grouping, §8 design D):
 * Dashboard, Students, Team, Schedule, Grading, Billing, Waivers,
 * Organisation, Notifications.
 *
 * It never decides who sees what. It takes the exact list of pages the classic
 * sidebar shows this person (Shell.tsx, every role and permission check
 * there) and only sorts those pages into groups. A group shows when at least
 * one of its pages is in the list; it opens the first of them, and the others
 * become tabs at the top of the page. A page the groups don't name (a coach's
 * "My belts", "My coach profile") keeps its own row, so nothing a person can
 * reach today goes missing.
 */

export type MenuGroupId =
  | 'dashboard'
  | 'students'
  | 'team'
  | 'schedule'
  | 'grading'
  | 'billing'
  | 'waivers'
  | 'organisation'
  | 'notifications';

export type MenuIcon = MenuGroupId | 'settings' | 'page';

/** Each group's pages, in tab order. Only routes the portal already has. */
export const MENU_GROUPS: ReadonlyArray<{ id: MenuGroupId; routes: readonly string[] }> = [
  { id: 'dashboard', routes: ['/dashboard', '/coach'] },
  // DESIGN.md → "Check-in and front-desk mode": Students → Check-in.
  { id: 'students', routes: ['/students', '/check-in'] },
  // Decision 456: one Team page, its tabs Staff · Coaches Info · Invite coaches.
  { id: 'team', routes: ['/staff', '/instructors', '/team/invite-coaches'] },
  { id: 'schedule', routes: ['/classes', '/timetable', '/curriculum', '/cancellations'] },
  { id: 'grading', routes: ['/grading', '/disciplines'] },
  { id: 'billing', routes: ['/membership-plans', '/transactions', '/billing-reports', '/payroll'] },
  { id: 'waivers', routes: ['/waivers'] },
  { id: 'organisation', routes: ['/school', '/branches', '/franchises'] },
  { id: 'notifications', routes: ['/notifications'] },
];

export interface MenuPage {
  label: string;
  to: string;
}

export interface MenuEntry {
  /** A group id, or `page:<route>` for a page that keeps its own row. */
  key: string;
  group: MenuGroupId | null;
  icon: MenuIcon;
  /** Where the row goes: the group's first page this person has. */
  to: string;
  /** The group's pages this person has, in tab order (one for a lone page). */
  pages: MenuPage[];
}

/** True when `pathname` is `route` or a page under it (`/students/123`). */
export function isUnder(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(route.endsWith('/') ? route : `${route}/`);
}

export function buildMenu(items: readonly MenuPage[]): MenuEntry[] {
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.to) ? false : (seen.add(i.to), true)));
  const grouped = new Set<string>();
  const entries: MenuEntry[] = [];
  for (const g of MENU_GROUPS) {
    const pages = g.routes.flatMap((r) => unique.filter((i) => i.to === r));
    pages.forEach((p) => grouped.add(p.to));
    if (pages.length) entries.push({ key: g.id, group: g.id, icon: g.id, to: pages[0].to, pages });
  }
  // Pages no group names keep their own row, in the classic order, just
  // before Notifications (which the classic coach menu also lists last).
  const loose: MenuEntry[] = unique
    .filter((i) => !grouped.has(i.to))
    .map((i) => ({ key: `page:${i.to}`, group: null, icon: 'page' as const, to: i.to, pages: [i] }));
  const notifications = entries.findIndex((e) => e.group === 'notifications');
  if (notifications === -1) return [...entries, ...loose];
  return [...entries.slice(0, notifications), ...loose, ...entries.slice(notifications)];
}

/** The menu entry the current page belongs to, if any (the longest match wins). */
export function activeEntry(menu: readonly MenuEntry[], pathname: string): MenuEntry | null {
  let best: { entry: MenuEntry; length: number } | null = null;
  for (const entry of menu) {
    for (const page of entry.pages) {
      if (isUnder(pathname, page.to) && (!best || page.to.length > best.length)) best = { entry, length: page.to.length };
    }
  }
  return best?.entry ?? null;
}

/** The tab of the active entry the current page belongs to. */
export function activePage(entry: MenuEntry, pathname: string): MenuPage | null {
  return entry.pages.filter((p) => isUnder(pathname, p.to)).sort((a, b) => b.to.length - a.to.length)[0] ?? null;
}
