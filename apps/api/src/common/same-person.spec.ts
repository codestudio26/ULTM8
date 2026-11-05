import { sameDay, sameName } from './same-person';

/** Decision 430 item 4 (FAM-4): the same child added again is recognised. */
describe('sameName / sameDay', () => {
  it('ignores spaces at the ends and case', () => {
    expect(sameName('  Abubakar ', 'abubakar')).toBe(true);
  });

  it('matches a name typed with precomposed or combining accents', () => {
    const precomposed = 'Ọ̀ṣọ́'.normalize('NFC');
    const decomposed = 'Ọ̀ṣọ́'.normalize('NFD');
    expect(precomposed).not.toBe(decomposed);
    expect(sameName(precomposed, decomposed)).toBe(true);
  });

  it('keeps twins apart', () => {
    expect(sameName('Ada', 'Obi')).toBe(false);
  });

  it('compares calendar dates', () => {
    expect(sameDay(new Date('2018-06-12T00:00:00.000Z'), '2018-06-12')).toBe(true);
    expect(sameDay(null, '2018-06-12')).toBe(false);
    expect(sameDay('2018-06-12', '2018-06-13')).toBe(false);
  });
});
