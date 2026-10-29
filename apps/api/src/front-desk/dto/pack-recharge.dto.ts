import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { AcademyMembershipPlanDto } from '../../academies/dto/academy-response.dto';

/** Decision 393: ask for a pack recharge when a Class Pack ran out at check-in. */
export class CreatePackRechargeDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({ description: 'The QR or code lookup the person was found with. Needed on a tablet (Decision 388).' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lookupToken?: string;

  @ApiProperty({ type: [String], description: 'The Classes to check in to once paid. Up to 10.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  classIds!: string[];
}

export class PackRechargeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'The pack to buy again. The desk can also sell it there (Decision 395).' }) membershipPlanId!: string;
  @ApiProperty() planTitle!: string;
  @ApiProperty({ description: 'Minor units.' }) price!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}

export class PackRechargeStatusDto {
  @ApiProperty({ description: 'The same pack has been bought since the recharge was asked for.' }) paid!: boolean;
  @ApiProperty({ description: 'The Classes\' check-in has closed: the offer is over.' }) expired!: boolean;
  @ApiProperty() completed!: boolean;
}

export class MyPackRechargeDto {
  @ApiProperty() id!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty() schoolName!: string;
  @ApiProperty({ description: 'Whose pack: the caller, or a child the caller is Guardian of.' }) studentId!: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: "The child's first name when it isn't the caller's own pack." })
  childFirstName!: string | null;
  @ApiProperty({ type: AcademyMembershipPlanDto }) plan!: AcademyMembershipPlanDto;
  @ApiProperty({ format: 'date-time' }) expiresAt!: Date;
}

export class MyPackRechargeListDto {
  @ApiProperty({ type: [MyPackRechargeDto] }) items!: MyPackRechargeDto[];
}
