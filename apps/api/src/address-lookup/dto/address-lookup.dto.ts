import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO31661Alpha2, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Google's session token: URL- and filename-safe base64, at most 36 characters (a UUID fits). */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{1,36}$/;
/** A BCP 47 language tag such as "en-GB", "pt-BR" or "ja". */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

class LookupLanguageQuery {
  @ApiPropertyOptional({
    description: 'Language for the results, as a BCP 47 tag (the app’s current language, e.g. "pt-BR"). Defaults to the request’s Accept-Language.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  @Matches(LANGUAGE_TAG)
  language?: string;

  @ApiPropertyOptional({
    description:
      'Groups one search and the chosen result into one Google session (cheaper, Google’s recommended use). Any string of letters, digits, "-" or "_", up to 36 characters; a new UUID per search.',
  })
  @IsOptional()
  @IsString()
  @Matches(SESSION_TOKEN)
  sessionToken?: string;
}

export class AddressAutocompleteQueryDto extends LookupLanguageQuery {
  @ApiProperty({ description: 'What the person has typed so far.', maxLength: 200 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({ description: 'Only suggest addresses in this country (ISO 3166-1 alpha-2, e.g. "GB").' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsISO31661Alpha2()
  country?: string;
}

export class AddressDetailsQueryDto extends LookupLanguageQuery {
  @ApiProperty({ description: 'A `placeId` from an autocomplete suggestion.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  placeId!: string;
}

export class AddressLookupStatusDto {
  @ApiProperty({ description: 'False until the server has a Google Places API key; the apps then hide the search box.' })
  enabled!: boolean;
}

export class AddressSuggestionDto {
  @ApiProperty() placeId!: string;
  @ApiProperty({ description: 'The whole suggestion as one line.' }) text!: string;
  @ApiProperty({ description: 'The main part, usually the street and number.' }) mainText!: string;
  @ApiProperty({ description: 'The rest, usually the town and country. May be empty.' }) secondaryText!: string;
}

export class AddressAutocompleteResponseDto {
  @ApiProperty({ type: [AddressSuggestionDto] })
  suggestions!: AddressSuggestionDto[];
}

export class LookedUpPostalAddressDto {
  @ApiProperty() line1!: string;
  @ApiProperty() line2!: string;
  @ApiProperty() city!: string;
  @ApiProperty({ description: 'For countries with a fixed list (US, CA, AU, AE, BR, MY), the list value.' }) region!: string;
  @ApiProperty() postalCode!: string;
  @ApiProperty({ description: 'ISO 3166-1 alpha-2.' }) country!: string;
}

export class AddressDetailsResponseDto {
  @ApiProperty() placeId!: string;
  @ApiProperty({ type: LookedUpPostalAddressDto, description: 'Ready to send as `postalAddress`; fields Google didn’t give are empty.' })
  postalAddress!: LookedUpPostalAddressDto;
  @ApiProperty({ description: 'The address as one line, in the country’s own order (what the API stores in `address`).' })
  formattedAddress!: string;
  @ApiProperty({ description: 'True when every field the country requires is filled and valid, so it can be saved as it is.' })
  complete!: boolean;
}
