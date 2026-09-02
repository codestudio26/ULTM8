import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber } from 'class-validator';

/** Spec §8.1: "Forgot/reset password is phone-based: an SMS OTP is sent..." */
export class RequestPasscodeResetDto {
  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;
}
