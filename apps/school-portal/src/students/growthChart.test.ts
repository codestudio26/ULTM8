import { describe, expect, it } from '@jest/globals';
import { barHeights, monthLabel } from './growthChart';

describe('Growth chart', () => {
  it('scales bars to the largest value', () => {
    expect(barHeights([0, 5, 10])).toEqual([0, 50, 100]);
  });

  it('draws nothing when every month is empty', () => {
    expect(barHeights([0, 0, 0])).toEqual([0, 0, 0]);
    expect(barHeights([])).toEqual([]);
  });

  it('keeps a small month visible', () => {
    expect(barHeights([1, 500])).toEqual([2, 100]);
  });

  it('names the month itself, whatever the viewer’s time zone', () => {
    expect(monthLabel('2026-01', 'en-GB')).toBe('Jan 26');
    expect(monthLabel('2025-12', 'en-GB')).toBe('Dec 25');
  });
});
