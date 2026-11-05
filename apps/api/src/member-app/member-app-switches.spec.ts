import { gradingCountdown } from './member-app-switches';

describe('gradingCountdown (Decision 318 item 7)', () => {
  const working = { hasNext: true, requiredClasses: 10, countedClasses: 4, requiredDays: 30, elapsedDays: 10 };

  it('counts the days to the next grading day and what the student still needs', () => {
    expect(gradingCountdown('2027-03-24', '2027-03-01', working, false)).toEqual({ nextGradingDate: '2027-03-24', daysUntilGrading: 23, classesToGo: 6, daysToGo: 20 });
  });

  it('shows a grading day that is today, and hides one that has passed', () => {
    expect(gradingCountdown('2027-03-01', '2027-03-01', working, false).daysUntilGrading).toBe(0);
    expect(gradingCountdown('2027-02-28', '2027-03-01', working, false)).toMatchObject({ nextGradingDate: null, daysUntilGrading: null });
    expect(gradingCountdown(null, '2027-03-01', working, false)).toMatchObject({ nextGradingDate: null, daysUntilGrading: null, classesToGo: 6 });
  });

  it('never counts below zero', () => {
    expect(gradingCountdown(null, '2027-03-01', { hasNext: true, requiredClasses: 10, countedClasses: 14, requiredDays: 30, elapsedDays: 40 }, false)).toMatchObject({ classesToGo: 0, daysToGo: 0 });
  });

  it('has no classes to count on a time-only rank, and nothing at the top of the ladder or on a style no longer taught', () => {
    expect(gradingCountdown(null, '2027-03-01', { ...working, timeOnly: true }, false)).toMatchObject({ classesToGo: null, daysToGo: 20 });
    expect(gradingCountdown(null, '2027-03-01', { hasNext: false }, false)).toMatchObject({ classesToGo: null, daysToGo: null });
    expect(gradingCountdown(null, '2027-03-01', working, true)).toMatchObject({ classesToGo: null, daysToGo: null });
  });
});
