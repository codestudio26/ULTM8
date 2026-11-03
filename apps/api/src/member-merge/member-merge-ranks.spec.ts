import { addClassCounts, compareLadderPositions, furtherSkillStatus, keptBeltOwner } from './member-merge-ranks';

describe('member-merge-ranks (Decision 422 item 8)', () => {
  it('orders by belt first, then by stripe tier; no tier is below the first tier', () => {
    expect(compareLadderPositions({ rankOrder: 1, tierOrder: 0 }, { rankOrder: 0, tierOrder: 4 })).toBeGreaterThan(0);
    expect(compareLadderPositions({ rankOrder: 0, tierOrder: 1 }, { rankOrder: 0, tierOrder: 2 })).toBeLessThan(0);
    expect(compareLadderPositions({ rankOrder: 2, tierOrder: null }, { rankOrder: 2, tierOrder: 0 })).toBeLessThan(0);
    expect(compareLadderPositions({ rankOrder: 2, tierOrder: 3 }, { rankOrder: 2, tierOrder: 3 })).toBe(0);
  });

  it("keeps the duplicate's belt only when it is strictly higher", () => {
    expect(keptBeltOwner({ rankOrder: 1, tierOrder: 0 }, { rankOrder: 0, tierOrder: 2 })).toBe('KEPT');
    expect(keptBeltOwner({ rankOrder: 0, tierOrder: 1 }, { rankOrder: 0, tierOrder: 2 })).toBe('DUPLICATE');
    expect(keptBeltOwner({ rankOrder: 0, tierOrder: 2 }, { rankOrder: 0, tierOrder: 2 })).toBe('KEPT');
    expect(keptBeltOwner({ rankOrder: 3, tierOrder: null }, { rankOrder: 3, tierOrder: null })).toBe('KEPT');
  });

  it('keeps the further sign-off status', () => {
    expect(furtherSkillStatus('LEARNING', 'SIGNED_OFF')).toBe('SIGNED_OFF');
    expect(furtherSkillStatus('SIGNED_OFF', 'NOT_STARTED')).toBe('SIGNED_OFF');
    expect(furtherSkillStatus('NOT_STARTED', 'LEARNING')).toBe('LEARNING');
    expect(furtherSkillStatus('LEARNING', 'LEARNING')).toBe('LEARNING');
  });

  it('adds class counts per type, ignoring anything that is not a number', () => {
    expect(addClassCounts({ Fundamentals: 2 }, { Fundamentals: 1, Sparring: 3 })).toEqual({ Fundamentals: 3, Sparring: 3 });
    expect(addClassCounts({}, null)).toEqual({});
    expect(addClassCounts({ A: 'x' }, [1, 2])).toEqual({});
  });
});
