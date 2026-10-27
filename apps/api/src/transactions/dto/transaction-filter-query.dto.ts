import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export const TRANSACTION_STATUSES = ['SUCCESSFUL', 'PENDING', 'FAILED', 'REFUNDED', 'DISPUTED'] as const;
export const TRANSACTION_METHODS = ['STRIPE', 'CASH', 'BANK_TRANSFER', 'PIX', 'CARD_TERMINAL'] as const;
export const TRANSACTION_KINDS = ['MEMBERSHIP', 'RENEWAL', 'LATE_CANCEL_FEE'] as const;

/** The Transactions page's filters (Decision 346, G3). All optional; together
 * they narrow the ledger, its tiles and the CSV export the same way. `from` and
 * `to` are calendar dates, both included. */
export class TransactionFilterDto {
  @ApiPropertyOptional({ enum: TRANSACTION_STATUSES })
  @IsOptional()
  @IsIn(TRANSACTION_STATUSES)
  status?: (typeof TRANSACTION_STATUSES)[number];

  @ApiPropertyOptional({ enum: TRANSACTION_METHODS })
  @IsOptional()
  @IsIn(TRANSACTION_METHODS)
  paymentMethod?: (typeof TRANSACTION_METHODS)[number];

  @ApiPropertyOptional({ enum: TRANSACTION_KINDS })
  @IsOptional()
  @IsIn(TRANSACTION_KINDS)
  kind?: (typeof TRANSACTION_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  membershipPlanId?: string;

  @ApiPropertyOptional({ description: 'First day included, YYYY-MM-DD (UTC).' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ description: 'Last day included, YYYY-MM-DD (UTC).' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}

export class TransactionListQueryDto extends IntersectionType(PaginationQueryDto, TransactionFilterDto) {}
