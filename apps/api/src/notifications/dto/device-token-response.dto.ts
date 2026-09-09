import { ApiProperty } from '@nestjs/swagger';
import { DEVICE_PLATFORMS, DevicePlatform } from './device-platform';

export class DeviceTokenResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  platform!: DevicePlatform;

  @ApiProperty()
  token!: string;

  @ApiProperty()
  lastSeenAt!: string;

  @ApiProperty()
  createdAt!: string;
}
