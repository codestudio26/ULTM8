import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * `POST /schools/:schoolId/notifications/broadcast` (v1.2 backend backlog's
 * "Compose/broadcast a message to Students" gap, Decision 230). Deliberately
 * no audience/targeting field — the backlog doc itself flags narrower
 * targeting (by Branch or Class) as "a real product question, not a
 * Developer default to invent"; this always targets every active Student at
 * the School, the one confirmed, uncontroversial default. Same
 * title/body shape as CreateWaiverDto, the nearest precedent for
 * School-Owner-authored text sent to Students.
 */
export class BroadcastNotificationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  body!: string;
}
