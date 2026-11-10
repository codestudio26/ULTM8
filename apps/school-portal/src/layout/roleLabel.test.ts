import { describe, expect, it } from '@jest/globals';
import type { RoleGrantClaim } from '../auth/types';
import { roleLabel } from './roleLabel';

// The catalogue key itself, so the test reads which label was picked.
const t = ((key: string) => key) as Parameters<typeof roleLabel>[2];
const grant = (role: string, schoolId: string | null = null) => ({ role, schoolId, branchId: null }) as unknown as RoleGrantClaim;

describe('roleLabel (the header role under the account name)', () => {
  it('a Franchise owner reads "Franchise owner", never the raw FRANCHISE_OWNER', () => {
    expect(roleLabel([grant('FRANCHISE_OWNER')], null, t)).toBe('lib.roles.franchiseOwner');
    expect(roleLabel([grant('FRANCHISE_OWNER')], 'school-1', t)).toBe('lib.roles.franchiseOwner');
  });

  it('a Franchise owner who also trains somewhere still reads Franchise owner', () => {
    expect(roleLabel([grant('STUDENT', 'school-1'), grant('FRANCHISE_OWNER')], 'school-1', t)).toBe('lib.roles.franchiseOwner');
  });

  it('a role at the School being worked in still comes first', () => {
    expect(roleLabel([grant('FRANCHISE_OWNER'), grant('SCHOOL_OWNER_MANAGER', 'school-1')], 'school-1', t)).toBe('layout.roles.owner');
    expect(roleLabel([grant('FRANCHISE_OWNER'), grant('INSTRUCTOR', 'school-1')], 'school-1', t)).toBe('layout.roles.coach');
  });

  it('every other known role by its name; an unknown code as sent; no grant, nothing', () => {
    expect(roleLabel([grant('GUARDIAN')], null, t)).toBe('lib.roles.guardian');
    expect(roleLabel([grant('SOMETHING_NEW')], null, t)).toBe('SOMETHING_NEW');
    expect(roleLabel([], null, t)).toBe('');
    expect(roleLabel(undefined, null, t)).toBe('');
  });
});
