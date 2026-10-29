import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsISO31661Alpha2, IsOptional, Max, Min } from 'class-validator';
import { CARD_SURCHARGE_MAX_BPS } from '../../payments/card-surcharge';

/** One country on the Platform Admin allow-list (Decision 406). */
export class CardSurchargeCountryDto {
  @ApiProperty({ description: 'ISO 3166-1 alpha-2, in capitals.' })
  countryCode!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class CardSurchargeCountryListDto {
  @ApiProperty({ type: [CardSurchargeCountryDto] })
  items!: CardSurchargeCountryDto[];
}

export class AddCardSurchargeCountryDto {
  @ApiProperty({ description: 'ISO 3166-1 alpha-2 country code, e.g. "US". Add a country only after legal review.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsISO31661Alpha2()
  countryCode!: string;
}

/** A School's card surcharge setting, as its owner sees it (Decision 406). */
export class CardSurchargeSettingsDto {
  @ApiProperty({ description: "Whether the School's country is on the allow-list. When false the setting is hidden and can't be changed, and no surcharge is charged." })
  available!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The School's country (its address), ISO 3166-1 alpha-2." })
  country!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ description: `Basis points: 250 = 2.5%. At most ${CARD_SURCHARGE_MAX_BPS}. Kept while off.` })
  bps!: number;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'When the owner last confirmed surcharges are legal where the School operates.' })
  confirmedAt!: Date | null;

  @ApiProperty({ description: 'Whether card payments are surcharged right now: on, the country allowed, and the School takes card payments.' })
  applies!: boolean;
}

export class UpdateCardSurchargeSettingsDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ description: `Basis points: 250 = 2.5%, 1 to ${CARD_SURCHARGE_MAX_BPS} when enabled.` })
  @IsInt()
  @Min(0)
  @Max(CARD_SURCHARGE_MAX_BPS)
  bps!: number;

  @ApiPropertyOptional({ description: '"I confirm surcharges are legal where my School operates." Required (true) to switch it on or save it while on.' })
  @IsOptional()
  @IsBoolean()
  legalConfirmed?: boolean;
}
