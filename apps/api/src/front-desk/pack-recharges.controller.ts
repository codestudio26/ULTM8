import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DeskCheckInResponseDto } from '../attendance/dto/desk-check-in.dto';
import { PackRechargesService } from './pack-recharges.service';
import { CreatePackRechargeDto, MyPackRechargeListDto, PackRechargeDto, PackRechargeStatusDto } from './dto/pack-recharge.dto';

/** Decision 393 (handover F8): "Pack used up: buy the same pack". */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PackRechargesController {
  constructor(private readonly recharges: PackRechargesService) {}

  /** Staff who may check people in: offer the same pack in the person's app. */
  @ApiCreatedResponse({ type: PackRechargeDto })
  @Post('schools/:schoolId/front-desk/pack-recharges')
  create(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: CreatePackRechargeDto) {
    return this.recharges.create(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: PackRechargeStatusDto })
  @Get('schools/:schoolId/front-desk/pack-recharges/:id')
  status(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recharges.status(user.sub, schoolId, id);
  }

  /** Once paid: checks the person in to the same Classes. */
  @ApiOkResponse({ type: DeskCheckInResponseDto })
  @HttpCode(200)
  @Post('schools/:schoolId/front-desk/pack-recharges/:id/complete')
  complete(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.recharges.complete(user.sub, schoolId, id);
  }

  /** The member's (and a Guardian's children's) packs to buy again. */
  @ApiOkResponse({ type: MyPackRechargeListDto })
  @Get('pack-recharges/me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.recharges.mine(user.sub);
  }
}
