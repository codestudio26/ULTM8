import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * POST /transactions/{id}/refund (Decision 430, MON-8): the owner records
 * money given back by hand for a membership paid at the desk (cash, bank
 * transfer, Pix or the School's own card terminal), part or all of it.
 */
export class RefundDeskSaleDto {
  @ApiProperty({ minimum: 1, description: 'Minor units (hundredths of the major unit), at most what is left to refund on the payment.' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ maxLength: 500, description: 'Required: why, and how the money was given back. For staff only; never sent to the member.' })
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes!: string;

  @ApiPropertyOptional({ default: false, description: 'End the membership now (its future bookings it pays for are cancelled). Off: the membership carries on.' })
  @IsOptional()
  @IsBoolean()
  endMembership?: boolean;
}

export class DeskSaleRefundDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  transactionId!: string;

  @ApiProperty({ description: 'Minor units.' })
  amount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  notes!: string;

  @ApiProperty()
  endedMembership!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class RefundDeskSaleResponseDto {
  @ApiProperty({ type: DeskSaleRefundDto })
  refund!: DeskSaleRefundDto;

  @ApiProperty({ description: "The payment's refunded total after this refund, minor units." })
  refundedAmount!: number;

  @ApiProperty({ enum: ['SUCCESSFUL', 'REFUNDED'], description: 'Refunded once all of it is back.' })
  status!: 'SUCCESSFUL' | 'REFUNDED';

  @ApiProperty({ description: 'Whether this refund ended the membership.' })
  membershipEnded!: boolean;
}
