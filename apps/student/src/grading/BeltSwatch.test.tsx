import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { BeltSwatch } from './BeltSwatch';
import type { GradingRung } from './myGradingQueries';

const rung = (over: Partial<GradingRung>): GradingRung => ({
  id: 'r1',
  name: 'Beginner 2',
  beltName: 'Beginner',
  primaryColour: '#2A9D8F',
  secondaryColour: null,
  stripeColour: '#FFFFFF',
  stripeCount: 0,
  timeOnly: false,
  rankDisplay: 'BELTS',
  step: 2,
  steps: 3,
  ...over,
});

describe('BeltSwatch (Decision 290)', () => {
  it('draws a level as a badge with one dot per step', async () => {
    const { getByTestId } = await render(<BeltSwatch rung={rung({ rankDisplay: 'LEVELS' })} />);
    const badge = getByTestId('level-step-2-of-3', { includeHiddenElements: true });
    expect(badge.children).toHaveLength(3);
  });

  it('draws a belt style as a belt, with no step dots', async () => {
    const { queryByTestId } = await render(<BeltSwatch rung={rung({})} />);
    expect(queryByTestId('level-step-2-of-3', { includeHiddenElements: true })).toBeNull();
  });
});
