import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@ultm8/i18n';
import { PRODUCT_UPDATE_LOCALES, READER_LOCALES } from './dto/whats-new.dto';

/** Decision 318 item 3: a post can be written in every School Portal language,
 * with English as the post itself. */
describe("What's new languages", () => {
  it('match the School Portal languages', () => {
    expect([...READER_LOCALES].sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(READER_LOCALES[0]).toBe(DEFAULT_LOCALE);
    expect(PRODUCT_UPDATE_LOCALES).not.toContain(DEFAULT_LOCALE);
  });
});
