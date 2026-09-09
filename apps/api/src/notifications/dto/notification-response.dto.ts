import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the Notification Prisma model — see
 * school-response.dto.ts's header comment for the nullable-field `type`+
 * `nullable: true` convention this follows. */
export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  read!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Developer-level discriminator — not spec-confirmed, see the Prisma model comment.' })
  type!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
