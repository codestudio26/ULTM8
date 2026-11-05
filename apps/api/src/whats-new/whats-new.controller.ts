import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { WhatsNewService } from './whats-new.service';
import { WhatsNewListDto, WhatsNewQueryDto } from './dto/whats-new.dto';

/** Decision 318 item 3: "What's new" for School owners and staff, newest first,
 * in the reader's language (English if a post has no translation in it). */
@ApiTags('whats-new')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WhatsNewController {
  constructor(private readonly whatsNew: WhatsNewService) {}

  @ApiOkResponse({ type: WhatsNewListDto })
  @Get('whats-new')
  list(@CurrentUser() user: JwtPayload, @Query() query: WhatsNewQueryDto) {
    return this.whatsNew.listForReader(user.sub, query);
  }
}
