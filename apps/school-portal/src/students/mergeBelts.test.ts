import { describe, expect, it } from '@jest/globals';
import { beltKeptLine } from './mergeBelts';

/** Decision 422 item 8: the merge preview says which belt is kept, and whose. */
describe('beltKeptLine', () => {
  const belt = { styleName: 'BJJ', keptBelt: 'Blue Belt', otherBelt: 'White Belt · 2 Stripes', sameRung: false };

  it('names the record the kept belt comes from, and the other belt', () => {
    expect(beltKeptLine({ ...belt, keptFrom: 'KEPT' }, 'Kate', 'Dan')).toEqual({
      key: 'students.merge.beltKept',
      params: { style: 'BJJ', belt: 'Blue Belt', name: 'Kate', otherBelt: 'White Belt · 2 Stripes' },
    });
    expect(beltKeptLine({ ...belt, keptFrom: 'DUPLICATE' }, 'Kate', 'Dan').params.name).toBe('Dan');
  });

  it('says both are on the same rung when they are', () => {
    expect(beltKeptLine({ ...belt, otherBelt: 'Blue Belt', sameRung: true, keptFrom: 'KEPT' }, 'Kate', 'Dan')).toEqual({
      key: 'students.merge.beltSameRung',
      params: { style: 'BJJ', belt: 'Blue Belt', name: 'Kate' },
    });
  });
});
