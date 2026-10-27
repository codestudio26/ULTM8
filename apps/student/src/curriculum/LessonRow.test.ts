import { describe, expect, it } from '@jest/globals';
import { formatDuration } from './LessonRow';

/** Lesson length as m:ss, like the School Portal (Decision 326). */
describe('formatDuration', () => {
  it('shows minutes and seconds, and hours from an hour up', () => {
    expect(formatDuration(270)).toBe('4:30');
    expect(formatDuration(45)).toBe('0:45');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3900)).toBe('1:05:00');
  });

  it('shows nothing without a duration', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});
