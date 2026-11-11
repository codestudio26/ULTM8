import { describe, expect, it } from '@jest/globals';
import { activeEntry, activePage, buildMenu, isUnder } from './newLookMenu';

const owner = [
  '/dashboard', '/school', '/branches', '/staff', '/disciplines', '/instructors', '/team/invite-coaches', '/students', '/grading', '/classes',
  '/curriculum', '/timetable', '/membership-plans', '/transactions', '/billing-reports', '/payroll', '/cancellations',
  '/waivers', '/franchises', '/notifications',
].map((to) => ({ label: to.slice(1), to }));

const coach = ['/coach', '/grading', '/disciplines', '/curriculum', '/classes', '/check-in', '/students', '/my-belts', '/complete-instructor-profile', '/notifications'].map(
  (to) => ({ label: to.slice(1), to }),
);

describe('the new look side menu', () => {
  it("groups the owner's pages into the nine design groups, every page kept", () => {
    const menu = buildMenu(owner);
    expect(menu.map((e) => e.key)).toEqual(['dashboard', 'students', 'team', 'schedule', 'grading', 'billing', 'waivers', 'organisation', 'notifications']);
    expect(menu.flatMap((e) => e.pages.map((p) => p.to)).sort()).toEqual(owner.map((p) => p.to).sort());
    const team = menu.find((e) => e.key === 'team')!;
    // Decision 456: Staff · Coaches Info · Invite coaches.
    expect(team.to).toBe('/staff');
    expect(team.pages.map((p) => p.to)).toEqual(['/staff', '/instructors', '/team/invite-coaches']);
  });

  it("shows only the groups a coach has pages in, and keeps a coach's own pages as rows", () => {
    const menu = buildMenu(coach);
    expect(menu.map((e) => e.key)).toEqual([
      'dashboard', 'students', 'schedule', 'grading', 'page:/my-belts', 'page:/complete-instructor-profile', 'notifications',
    ]);
    expect(menu[0].to).toBe('/coach');
    expect(menu.flatMap((e) => e.pages.map((p) => p.to)).sort()).toEqual(coach.map((p) => p.to).sort());
  });

  it('never adds a page that was not in the list', () => {
    const menu = buildMenu([{ label: 'Grading', to: '/grading' }]);
    expect(menu).toHaveLength(1);
    expect(menu[0].pages).toEqual([{ label: 'Grading', to: '/grading' }]);
  });

  it('finds the group and tab of the page you are on', () => {
    const menu = buildMenu(owner);
    expect(activeEntry(menu, '/students/123')?.key).toBe('students');
    expect(activeEntry(menu, '/disciplines/9')?.key).toBe('grading');
    const billing = activeEntry(menu, '/billing-reports')!;
    expect(activePage(billing, '/billing-reports')?.to).toBe('/billing-reports');
    expect(activeEntry(menu, '/profile')).toBeNull();
  });

  it('matches whole path segments only', () => {
    expect(isUnder('/students', '/students')).toBe(true);
    expect(isUnder('/students/add', '/students')).toBe(true);
    expect(isUnder('/studentsx', '/students')).toBe(false);
  });
});
