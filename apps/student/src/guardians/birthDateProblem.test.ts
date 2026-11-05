import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../api', () => ({ apiClient: {} }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { birthDateProblem } = require('./MyMinorsScreen') as typeof import('./MyMinorsScreen');

/** Decision 429 item 3: the app checks a child's date of birth before sending it. */
describe('birthDateProblem', () => {
  const today = new Date(2026, 10, 5);

  it('accepts a child, and says nothing while the field is empty', () => {
    expect(birthDateProblem('2016-03-04', today)).toBeNull();
    expect(birthDateProblem(' 2026-11-05 ', today)).toBeNull();
    expect(birthDateProblem('', today)).toBeNull();
  });

  it('refuses a date that is not real', () => {
    expect(birthDateProblem('2016-02-30', today)).toBe('guardians.myMinors.dateInvalid');
    expect(birthDateProblem('04/03/2016', today)).toBe('guardians.myMinors.dateInvalid');
    expect(birthDateProblem('1800-01-01', today)).toBe('guardians.myMinors.dateInvalid');
  });

  it('refuses a future date and an adult', () => {
    expect(birthDateProblem('2026-11-06', today)).toBe('guardians.myMinors.dateFuture');
    expect(birthDateProblem('2008-11-05', today)).toBe('guardians.myMinors.dateAdult');
    expect(birthDateProblem('2008-11-06', today)).toBeNull();
  });
});
