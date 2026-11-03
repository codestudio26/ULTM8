import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, isISO31661Alpha2 } from 'class-validator';
import {
  PostalAddress,
  PostalAddressErrors,
  formatPostalAddress,
  getAddressFormat,
  isPostalAddressEmpty,
  normalizePostalAddress,
  validatePostalAddress,
} from './postal-address';

/**
 * Decision 276 — the structured address a client sends in place of the old
 * single free-text `address`. Only shape and length are checked here; the
 * per-country rules (which fields are required, postal-code format, fixed
 * region lists) live in `postal-address.ts` and run in `addressWriteData()`,
 * since they depend on more than one field at once.
 */
export class PostalAddressDto {
  @ApiPropertyOptional({ description: 'Street address, line 1.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line1?: string;

  @ApiPropertyOptional({ description: 'Apartment, suite, building, floor, etc.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @ApiPropertyOptional({ description: 'City, town, post town or suburb, depending on the country.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'State, province, county, emirate, prefecture, etc. For countries with a fixed list (US, CA, AU, AE, BR, MY) this is the list value, e.g. "CA" for California.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @ApiPropertyOptional({ description: 'Postal code / ZIP / postcode, validated against the country’s own format.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code, e.g. "GB". Required unless every other field is blank.' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  country?: string;
}

/** The seven columns every addressable model (User, Franchise, School, Branch, Instructor) carries. */
export interface AddressColumns {
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  addressCountry: string | null;
}

const STRUCTURED_CLEARED = {
  addressLine1: null,
  addressLine2: null,
  addressCity: null,
  addressRegion: null,
  addressPostalCode: null,
  addressCountry: null,
} as const;

let regionNames: Intl.DisplayNames | undefined;
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const FIELD_NAMES: Record<keyof PostalAddressErrors, string> = {
  line1: 'line 1',
  line2: 'line 2',
  city: 'city',
  region: 'region',
  postalCode: 'postal code',
  country: 'country',
};

function errorMessages(errors: PostalAddressErrors, address: PostalAddress): string[] {
  const format = getAddressFormat(address.country);
  return (Object.keys(errors) as Array<keyof PostalAddressErrors>).map((field) => {
    const code = errors[field];
    const name = `postalAddress.${field}`;
    if (code === 'required') return `${name} is required for this country (${FIELD_NAMES[field]}).`;
    if (code === 'too_long') return `${name} is too long.`;
    if (field === 'postalCode') {
      return `${name} is not a valid postal code for ${countryName(address.country)}${format.postalExample ? ` (e.g. ${format.postalExample})` : ''}.`;
    }
    if (field === 'region') return `${name} must be one of ${countryName(address.country)}'s listed regions.`;
    return `${name} must be an ISO 3166-1 alpha-2 country code.`;
  });
}

/**
 * Turns a write DTO's address input into the Prisma `data` fragment for it.
 *
 *  - `postalAddress` given (object): validated against its country's rules,
 *    normalised, and stored as the six structured columns, plus `address` set
 *    to the one-line text so every existing reader of `address` (Academies
 *    discovery, School footer, platform-admin, apps/student) keeps working.
 *  - `postalAddress: null`, or an object with every field blank: clears all seven.
 *  - Only the legacy `address` string given (older clients, e.g. apps/student's
 *    profile screen): stored as-is, and the structured columns are cleared so
 *    they never disagree with the text.
 *  - Neither given: `{}`, so an update leaves the stored address alone.
 */
export function addressWriteData(dto: {
  address?: string | null;
  postalAddress?: PostalAddressDto | null;
}): Partial<AddressColumns> {
  if (dto.postalAddress !== undefined) {
    if (dto.postalAddress === null || isPostalAddressEmpty(dto.postalAddress)) {
      return { address: null, ...STRUCTURED_CLEARED };
    }
    const normalized = normalizePostalAddress(dto.postalAddress);
    const errors = validatePostalAddress(normalized);
    if (!errors.country && !isISO31661Alpha2(normalized.country)) errors.country = 'invalid';
    if (Object.keys(errors).length > 0) {
      throw new BadRequestException(errorMessages(errors, normalized));
    }
    return {
      address: formatPostalAddress(normalized, countryName(normalized.country)),
      addressLine1: normalized.line1 || null,
      addressLine2: normalized.line2 || null,
      addressCity: normalized.city || null,
      addressRegion: normalized.region || null,
      addressPostalCode: normalized.postalCode || null,
      addressCountry: normalized.country,
    };
  }
  if (dto.address !== undefined) {
    return { address: dto.address, ...STRUCTURED_CLEARED };
  }
  return {};
}

/** Response-DTO fields for the structured columns, shared by every addressable entity's response. */
export class PostalAddressColumnsResponseDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 276 — structured address, line 1.' })
  addressLine1!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  addressLine2!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  addressCity!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  addressRegion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  addressPostalCode!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'ISO 3166-1 alpha-2. Null = no structured address yet (the legacy free-text `address`, if any, is still in `address`).' })
  addressCountry!: string | null;
}
