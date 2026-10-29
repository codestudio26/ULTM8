import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/** Decision 315 item 15 (backlog 3.15): Female, Male, or not given. */
export const GENDERS = ['FEMALE', 'MALE'] as const;
export type Gender = (typeof GENDERS)[number];

/** An optional gender: FEMALE, MALE, or null (a blank string counts as null). */
export function GenderField() {
  return applyDecorators(
    ApiPropertyOptional({ enum: GENDERS, nullable: true, description: 'FEMALE, MALE, or null when not given.' }),
    Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value)),
    IsOptional(),
    IsIn(GENDERS, { message: 'Gender must be Female or Male, or left empty.' }),
  );
}
