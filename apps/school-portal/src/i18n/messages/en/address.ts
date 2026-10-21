/** Text inside the shared `AddressFields` from `@ultm8/ui` (Decision 276).
 * Keys mirror `ADDRESS_TEXT` there; `{field}` and `{example}` are filled by
 * the component itself. */
export const address = {
  legend: 'Address',
  country: 'Country',
  chooseCountry: 'Select a country',
  line1: 'Address line 1',
  line1Placeholder: 'Street address',
  line2: 'Address line 2',
  line2Placeholder: 'Apartment, suite, unit, building, floor',
  optional: 'optional',
  chooseRegion: 'Select…',
  postalExample: 'e.g. {example}',
  legacyNotice:
    'This address was saved as a single line before addresses had separate fields. Choose the country and check each field to update it, or leave it as it is.',
  city: { city: 'City', town: 'Town', post_town: 'Town/City', suburb: 'Suburb', district: 'District', area: 'Area' },
  region: {
    state: 'State',
    province: 'Province',
    county: 'County',
    emirate: 'Emirate',
    prefecture: 'Prefecture',
    region: 'State/Province/Region',
    do_si: 'Province (Do/Si)',
    oblast: 'Region (Oblast)',
    area: 'Area',
  },
  postal: { postal_code: 'Postal code', postcode: 'Postcode', zip: 'ZIP code', pin: 'PIN code', eircode: 'Eircode', cep: 'CEP' },
  errors: {
    required: '{field} is required.',
    countryRequired: 'Choose a country.',
    countryInvalid: 'Choose a country from the list.',
    tooLong: '{field} is too long.',
    postalInvalid: 'Enter a valid {field}, e.g. {example}.',
    postalInvalidNoExample: 'Enter a valid {field}.',
    regionInvalid: 'Choose a {field} from the list.',
  },
};
