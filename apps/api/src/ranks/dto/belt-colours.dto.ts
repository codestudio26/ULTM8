import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

export const MAX_SAVED_BELT_COLOURS = 24;

/** Backlog 3.18: the School's saved belt colours, sent as the whole list. */
export class SaveBeltColoursDto {
  @ApiProperty({ type: [String], example: ['#2A9D8F', '#E76F51'], description: 'Colour codes like #2A9D8F, in order. Repeats are dropped. At most 24.' })
  @IsArray()
  @ArrayMaxSize(MAX_SAVED_BELT_COLOURS)
  @IsString({ each: true })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { each: true, message: 'Use a colour code like #2A9D8F.' })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value))
  colours!: string[];
}

export class BeltColoursResponseDto {
  @ApiProperty({ type: [String], example: ['#2A9D8F'] })
  colours!: string[];
}
