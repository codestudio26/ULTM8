import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber } from 'class-validator';

export class SendOtpDto {
  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;
}
