import { describe, expect, it, jest } from '@jest/globals';
import { createAddressLookupProvider, type AddressLookupApi } from './addressLookup';

const UK = { line1: '10 Downing Street', line2: '', city: 'London', region: '', postalCode: 'SW1A 2AA', country: 'GB' };

function fakeApi() {
  const autocomplete = jest.fn<AddressLookupApi['autocomplete']>().mockResolvedValue({
    suggestions: [
      { placeId: 'p1', text: '10 Downing Street, London, UK', mainText: '10 Downing Street', secondaryText: 'London, UK' },
      { placeId: 'p2', text: 'Downing Street', mainText: '', secondaryText: '' },
    ],
  });
  const details = jest.fn<AddressLookupApi['details']>().mockResolvedValue({ postalAddress: UK });
  return { autocomplete, details };
}

describe('createAddressLookupProvider', () => {
  it('maps suggestions and fills the address from the chosen one', async () => {
    const api = fakeApi();
    const provider = createAddressLookupProvider(api, 'en-GB', () => 'tok');
    expect(await provider.suggest('10 Down', 'GB')).toEqual([
      { id: 'p1', label: '10 Downing Street', secondary: 'London, UK' },
      { id: 'p2', label: 'Downing Street', secondary: undefined },
    ]);
    expect(api.autocomplete).toHaveBeenCalledWith({ q: '10 Down', country: 'GB', sessionToken: 'tok', language: 'en-GB' });
    expect(await provider.resolve('p1')).toEqual(UK);
    expect(api.details).toHaveBeenCalledWith({ placeId: 'p1', sessionToken: 'tok', language: 'en-GB' });
  });

  it('keeps one session token per search and starts a new one after a pick', async () => {
    const api = fakeApi();
    let n = 0;
    const provider = createAddressLookupProvider(api, undefined, () => `tok-${++n}`);
    await provider.suggest('10 D', '');
    await provider.suggest('10 Do', '');
    await provider.resolve('p1');
    await provider.suggest('221', '');
    const tokens = api.autocomplete.mock.calls.map(([q]) => q.sessionToken);
    expect(tokens).toEqual(['tok-1', 'tok-1', 'tok-2']);
    expect(api.details.mock.calls[0][0].sessionToken).toBe('tok-1');
    expect(api.autocomplete.mock.calls[0][0].country).toBeUndefined();
  });

  it('starts a new session even when the pick fails', async () => {
    const api = fakeApi();
    api.details.mockRejectedValueOnce(new Error('502'));
    let n = 0;
    const provider = createAddressLookupProvider(api, 'fr', () => `tok-${++n}`);
    await provider.suggest('rue', 'FR');
    await expect(provider.resolve('p1')).rejects.toThrow('502');
    await provider.suggest('rue de', 'FR');
    expect(api.autocomplete.mock.calls[1][0].sessionToken).toBe('tok-2');
  });
});
