import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { MembershipPlanResponseDto } from '../dto/membership-plan-response.dto';
import { PlanContractsService } from './plan-contracts.service';
import {
  PlanContractDto,
  PlanContractForMemberQueryDto,
  PlanContractSignatureDto,
  PlanContractSignatureListDto,
  PlanContractUploadUrlDto,
  PlanContractUploadUrlResponseDto,
  SetPlanContractDto,
  SignPlanContractDto,
} from './plan-contract.dto';

/** Decision 316 item 6: contracts on plans. */
@ApiTags('memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PlanContractsController {
  constructor(private readonly contracts: PlanContractsService) {}

  /** The owner sets, changes or removes the plan's contract. */
  @ApiOkResponse({ type: MembershipPlanResponseDto })
  @Put('membership-plans/:id/contract')
  setContract(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPlanContractDto) {
    return this.contracts.setContract(user.sub, id, dto);
  }

  /** The member (or their Guardian) reads the contract before signing. */
  @ApiOkResponse({ type: PlanContractDto })
  @Get('membership-plans/:id/contract')
  getForSigning(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Query() query: PlanContractForMemberQueryDto) {
    return this.contracts.getForSigning(user.sub, id, query.studentId);
  }

  @ApiOkResponse({ type: PlanContractUploadUrlResponseDto })
  @HttpCode(200)
  @Post('membership-plans/:id/contract/signature-upload-url')
  uploadUrl(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanContractUploadUrlDto) {
    return this.contracts.requestSignatureUploadUrl(user.sub, id, dto.studentId);
  }

  /** Signs the contract; pass the returned id as contractSignatureId when buying. */
  @ApiOkResponse({ type: PlanContractSignatureDto })
  @HttpCode(200)
  @Post('membership-plans/:id/contract/sign')
  sign(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SignPlanContractDto) {
    return this.contracts.sign(user.sub, id, dto);
  }

  /** The owner: a Student's signed plan contracts. */
  @ApiOkResponse({ type: PlanContractSignatureListDto })
  @Get('schools/:schoolId/students/:studentId/plan-contracts')
  async listForStudent(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
  ) {
    return { data: await this.contracts.listForStudent(user.sub, schoolId, studentId) };
  }
}
