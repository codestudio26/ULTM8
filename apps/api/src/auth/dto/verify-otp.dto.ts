import { ApiProperty } from '@nestjs/swagger';
import { IsPhoneNumber, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ description: 'E.164 format' })
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone!: string;

  @ApiProperty({ description: 'The code delivered via Twilio Verify' })
  @IsString()
  @Length(4, 8)
  code!: string;
}
