import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * v1.2 backend backlog ("Notifications page" — Snooze, approved by the
 * product owner). Spec 55 confirms no snooze shape at all (NotificationsPage's
 * own backlog entry: "Needs a product decision on shape... before any endpoint
 * design makes sense") — the product owner's approval is for the FEATURE, not
 * a specific wire shape, so the exact body here is a Developer-level
 * presentation/UX choice per the kickoff brief, not a business rule.
 *
 * Exactly one of `until` (an explicit timestamp) or `minutes` (a duration from
 * now) must be given — this DTO can't enforce "exactly one" with plain
 * decorators alone, so NotificationsService.snooze() validates that itself and
 * throws a 400 otherwise. `until` wins if a caller somehow sends both (checked
 * first in the service).
 */
export class SnoozeNotificationDto {
  @ApiPropertyOptional({
    description: 'Snooze until this exact ISO-8601 timestamp. Must be in the future and at most 7 days away. Provide this OR `minutes`, not both.',
  })
  @IsOptional()
  @IsISO8601()
  until?: string;

  @ApiPropertyOptional({
    description:
      'Snooze for this many minutes from now (1 to 10080 / 7 days — a Developer-chosen upper bound, not a confirmed business rule). Provide this OR `until`, not both.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_080)
  minutes?: number;
}
