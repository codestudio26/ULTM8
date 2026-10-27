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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Snoozed until this timestamp, or null if not snoozed. Developer-level addition — see the Prisma model comment.',
  })
  snoozedUntil!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Set the first time PATCH /notifications/:id/read fires for this row, never overwritten after. Developer-level addition — see the Prisma model comment.',
  })
  readAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The School this notification came from (Decision 352), or null.' })
  schoolId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: "That School's name as it was when the notification was sent, shown as a label (Decision 352)." })
  schoolName!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ['CLASS', 'WAIVER', 'PAYMENT', 'CANCELLATIONS', 'GRADING'],
    description: 'What clicking the notification opens (Decision 352), or null for nothing.',
  })
  targetType!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The Class or Waiver id, for CLASS and WAIVER targets (Decision 352).' })
  targetId!: string | null;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
