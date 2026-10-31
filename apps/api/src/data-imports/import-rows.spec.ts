import {
  RowProblem,
  RowValues,
  isCalendarDay,
  normalizeHeader,
  parseBelts,
  parseBirthDate,
  parseCount,
  parseGender,
  parsePhone,
  parseTime,
} from './import-rows';

const problem = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof RowProblem) return { outcome: err.outcome, code: err.code, column: err.column };
    throw err;
  }
  return null;
};

describe('spreadsheet import rows (Decision 315 items 12, 13)', () => {
  it('reads headers as people type them', () => {
    expect(normalizeHeader(' First Name ')).toBe('first_name');
    expect(normalizeHeader('date-of-birth')).toBe('date_of_birth');
    const row = new RowValues({ 'First Name': '  Ana ', EMAIL: 'a@b.test' });
    expect(row.get('first_name')).toBe('Ana');
    expect(row.get('email')).toBe('a@b.test');
    expect(row.get('phone')).toBe('');
    expect(problem(() => row.required('phone'))).toEqual({ outcome: 'ERROR', code: 'MISSING_VALUE', column: 'phone' });
    expect(problem(() => new RowValues({ email: 'x'.repeat(201) }).get('email'))).toMatchObject({ code: 'TOO_LONG' });
  });

  it('takes real calendar days only', () => {
    expect(isCalendarDay('2024-02-29')).toBe(true);
    expect(isCalendarDay('2023-02-29')).toBe(false);
    expect(isCalendarDay('01/02/2024')).toBe(false);
    const now = new Date('2026-10-31T12:00:00Z');
    expect(parseBirthDate(new RowValues({ date_of_birth: '1990-05-06' }), now)).toBe('1990-05-06');
    expect(problem(() => parseBirthDate(new RowValues({ date_of_birth: '2027-01-01' }), now))).toMatchObject({ code: 'INVALID_BIRTH_DATE' });
    expect(problem(() => parseBirthDate(new RowValues({ date_of_birth: '6/5/1990' }), now))).toMatchObject({ code: 'INVALID_DATE' });
  });

  it('accepts Female, Male or empty for gender (Decision 315 item 15)', () => {
    expect(parseGender(new RowValues({ gender: 'FEMALE' }))).toBe('FEMALE');
    expect(parseGender(new RowValues({ gender: 'male' }))).toBe('MALE');
    expect(parseGender(new RowValues({ gender: '' }))).toBeNull();
    expect(problem(() => parseGender(new RowValues({ gender: 'Non-binary' })))).toMatchObject({ code: 'INVALID_GENDER', column: 'gender' });
  });

  it('takes an international phone number, spaces allowed', () => {
    expect(parsePhone(new RowValues({ phone: '+44 7911 123456' }))).toBe('+447911123456');
    expect(parsePhone(new RowValues({}))).toBeNull();
    expect(problem(() => parsePhone(new RowValues({ phone: '07911 123456' })))).toMatchObject({ code: 'INVALID_PHONE' });
  });

  it('reads belts as "Style: Belt; Style: Belt", one belt per style', () => {
    expect(parseBelts(new RowValues({ belts: 'Brazilian Jiu-Jitsu: Blue; Judo: Yellow ;' }))).toEqual([
      { style: 'Brazilian Jiu-Jitsu', belt: 'Blue' },
      { style: 'Judo', belt: 'Yellow' },
    ]);
    expect(parseBelts(new RowValues({}))).toEqual([]);
    expect(problem(() => parseBelts(new RowValues({ belts: 'Blue' })))).toMatchObject({ code: 'BELTS_FORMAT' });
    expect(problem(() => parseBelts(new RowValues({ belts: 'Judo: Yellow; judo: Orange' })))).toMatchObject({ code: 'BELTS_FORMAT' });
  });

  it('reads times and counts', () => {
    expect(parseTime(new RowValues({ time: '9:05' }), 'time')).toBe('09:05');
    expect(problem(() => parseTime(new RowValues({ time: '25:00' }), 'time'))).toMatchObject({ code: 'INVALID_TIME' });
    expect(parseCount(new RowValues({ classes_left: '6' }), 'classes_left')).toBe(6);
    expect(problem(() => parseCount(new RowValues({ classes_left: '-1' }), 'classes_left'))).toMatchObject({ code: 'INVALID_NUMBER' });
  });
});
