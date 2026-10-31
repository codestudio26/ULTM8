import { describe, expect, it } from '@jest/globals';
import { promoteToOptions, type Rung } from './ladder';

const rung = (id: string, rankId: string, index: number) => ({ id, rankId, index, name: id }) as unknown as Rung;

/** Bulk promote's "Promote to" (Decision 281 item 2; backlog 3.20). */
describe('promoteToOptions', () => {
  const kids = [rung('kw', 'KW', 0), rung('grey', 'G', 1), rung('grey1', 'G', 2), rung('green', 'GR', 3)];
  const adult = { ladder: [rung('w', 'W', 0), rung('w1', 'W', 1), rung('blue', 'B', 2), rung('purple', 'P', 3)] };

  it('lists the higher ranks of the style', () => {
    const { options, adultIds, firstAdultId } = promoteToOptions(kids, kids[1], adult, false);
    expect(options.map((r) => r.id)).toEqual(['grey1', 'green']);
    expect(adultIds.size).toBe(0);
    expect(firstAdultId).toBeNull();
  });

  it('adds the Adult ranks above its first belt for a kid who has reached the age', () => {
    const { options, adultIds, firstAdultId } = promoteToOptions(kids, kids[1], adult, true);
    expect(options.map((r) => r.id)).toEqual(['grey1', 'green', 'blue', 'purple']);
    expect([...adultIds]).toEqual(['blue', 'purple']);
    expect(firstAdultId).toBe('blue');
  });

  it('a kid on the top Kids rank gets only the Adult group; no Adult program, no group', () => {
    expect(promoteToOptions(kids, kids[3], adult, true).options.map((r) => r.id)).toEqual(['blue', 'purple']);
    expect(promoteToOptions(kids, kids[1], null, true).options.map((r) => r.id)).toEqual(['grey1', 'green']);
  });
});
