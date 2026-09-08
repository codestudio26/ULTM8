import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape — see class-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`). Field-for-
 * field match of the LegalDocument Prisma model.
 *
 * `content: null` is the expected, correct state for every currently-seeded row —
 * see schema.prisma's own LegalDocument comment for why real legal text was never
 * invented here. This is not an error state for a caller to special-case beyond
 * treating it as "not yet published."
 */
export class LegalDocumentResponseDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null until real legal/product content is populated.' })
  content!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
