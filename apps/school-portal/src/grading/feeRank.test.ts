import { describe, expect, it } from '@jest/globals';
import { feeRankName, feeStyleOf } from './feeRank';
import type { TranslateFn } from '../i18n/I18nProvider';

const t = ((key: string) => (key === 'grading.bulk.adultTag' ? '(Adult program)' : key)) as TranslateFn;

/** A move into the linked Adult program is charged like any promotion (Decision 419 item 2). */
describe('feeRankName', () => {
  it('names a grade within one style by its rank', () => {
    expect(feeRankName({ toRungName: 'Green Belt', toAdult: false }, t)).toBe('Green Belt');
    expect(feeRankName({ toRungName: 'Green Belt', toDisciplineId: null }, t)).toBe('Green Belt');
  });

  it('tags a move into the Adult program, from the board or the student\'s requests', () => {
    expect(feeRankName({ toRungName: 'Blue Belt', toAdult: true }, t)).toBe('Blue Belt (Adult program)');
    expect(feeRankName({ toRungName: 'Blue Belt', toDisciplineId: 'adult' }, t)).toBe('Blue Belt (Adult program)');
  });
});

describe('feeStyleOf', () => {
  it('a grade within one style shows on that style', () => {
    expect(feeStyleOf({ disciplineId: 'kids', toDisciplineId: null, promotionApplied: true })).toBe('kids');
  });

  it('a move into Adult shows on Kids until it applies, then on Adult', () => {
    expect(feeStyleOf({ disciplineId: 'kids', toDisciplineId: 'adult', promotionApplied: false })).toBe('kids');
    expect(feeStyleOf({ disciplineId: 'kids', toDisciplineId: 'adult', promotionApplied: true })).toBe('adult');
  });
});
