import { ApiProperty } from '@nestjs/swagger';

export class StepUpResponseDto {
  @ApiProperty({ description: 'Short-lived proof — send as the X-Step-Up-Token header on the one request it gates' })
  stepUpToken!: string;

  @ApiProperty()
  expiresAt!: string;
}
