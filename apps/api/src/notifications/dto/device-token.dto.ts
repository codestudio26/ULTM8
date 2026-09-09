import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { DEVICE_PLATFORMS, DevicePlatform } from './device-platform';

/**
 * `POST /notifications/device-tokens` body. Registration only, no explicit
 * write path is spec-confirmed for DeviceToken (Spec 55 §7's own endpoint
 * table lists only the two Notification read-side endpoints) — a Developer-
 * level, reasonable-minimum addition, same treatment User.phoneVerifiedAt
 * already established in this codebase. Idempotent by `token` (unique index) —
 * registering the same token twice (e.g. app relaunch) upserts rather than
 * erroring; a token already owned by a DIFFERENT User is a 409, not a silent
 * reassignment — see NotificationsService.registerDeviceToken's own header
 * comment.
 */
export class RegisterDeviceTokenDto {
  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsEnum(DEVICE_PLATFORMS)
  platform!: DevicePlatform;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  token!: string;
}
