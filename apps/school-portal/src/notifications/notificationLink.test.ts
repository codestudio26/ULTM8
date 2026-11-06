import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../api', () => ({ apiClient: {} }));

import { notificationLink } from './notificationQueries';

describe('notificationLink', () => {
  it('Decision 442 item 4: a STUDENT target opens the student, where Branch Staff mark an order paid', () => {
    expect(notificationLink({ targetType: 'STUDENT', targetId: 'stu-1' })).toBe('/students/stu-1');
    expect(notificationLink({ targetType: 'STUDENT', targetId: null })).toBeNull();
  });

  it('a PAYMENT target still opens the Transactions page', () => {
    expect(notificationLink({ targetType: 'PAYMENT', targetId: null })).toBe('/transactions');
  });
});
