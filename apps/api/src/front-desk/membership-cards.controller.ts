import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { MembershipCardsService } from './membership-cards.service';
import { MembershipCardDto, MembershipCardListDto } from './dto/front-desk.dto';

/** Membership cards (backlog 3.11): printed by staff, shown in the app. */
@ApiTags('front-desk')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MembershipCardsController {
  constructor(private readonly cards: MembershipCardsService) {}

  /** The caller's own cards, one for each School they are a Student at. */
  @ApiOkResponse({ type: MembershipCardListDto })
  @Get('membership-cards/me')
  mine(@CurrentUser() user: JwtPayload) {
    return this.cards.mine(user.sub);
  }

  /** The Student, their Guardian, or staff who cover them. */
  @ApiOkResponse({ type: MembershipCardDto })
  @Get('schools/:schoolId/students/:studentId/membership-card')
  card(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.cards.card(user.sub, schoolId, studentId);
  }
}
