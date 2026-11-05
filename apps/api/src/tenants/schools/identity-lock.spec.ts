import { changedIdentityFields } from './identity-lock';

/** Decision 430 item 13 (PRIV-2): only a real change to who the person is
 * counts; sending the same values back (the edit form sends every field) does
 * not. */
describe('changedIdentityFields', () => {
  const current = { firstName: 'Emil', surname: 'Bauer', dateOfBirth: new Date('2017-03-01T00:00:00.000Z'), gender: 'MALE' };

  it('ignores unchanged values', () => {
    expect(changedIdentityFields(current, { firstName: ' Emil ', surname: 'Bauer', dateOfBirth: '2017-03-01', gender: 'MALE' })).toEqual([]);
  });

  it('lists each field that changes', () => {
    expect(changedIdentityFields(current, { firstName: 'Emilio', dateOfBirth: '2000-01-01' })).toEqual(['firstName', 'dateOfBirth']);
    expect(changedIdentityFields(current, { gender: null })).toEqual(['gender']);
  });

  it('ignores fields not sent', () => {
    expect(changedIdentityFields(current, {})).toEqual([]);
  });
});
