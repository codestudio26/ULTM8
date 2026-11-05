import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ScheduleSharingService } from './schedule-sharing.service';
import { DeletedDto, MyCalendarFeedDto, ScheduleEmbedDto, ScheduleSharingSettingsDto, UpdateScheduleSharingDto } from './schedule-sharing.dto';
import { embedLocale, schedulePage, unavailablePage } from './embed-page';

/** Decision 319 item 4: the School's settings and each staff member's link. */
@ApiTags('schedule-sharing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId')
export class ScheduleSharingController {
  constructor(private readonly sharing: ScheduleSharingService) {}

  @ApiOkResponse({ type: ScheduleSharingSettingsDto })
  @Get('schedule-sharing')
  get(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sharing.getSettings(user.sub, schoolId);
  }

  @ApiOkResponse({ type: ScheduleSharingSettingsDto })
  @Put('schedule-sharing')
  update(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: UpdateScheduleSharingDto) {
    return this.sharing.updateSettings(user.sub, schoolId, dto);
  }

  @ApiOkResponse({ type: MyCalendarFeedDto })
  @Get('calendar-feed/me')
  myFeed(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sharing.getMyFeed(user.sub, schoolId);
  }

  @ApiOkResponse({ type: MyCalendarFeedDto })
  @HttpCode(200)
  @Post('calendar-feed/me')
  createFeed(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sharing.createMyFeed(user.sub, schoolId);
  }

  @ApiOkResponse({ type: DeletedDto })
  @Delete('calendar-feed/me')
  deleteFeed(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.sharing.deleteMyFeed(user.sub, schoolId);
  }
}

// No sign-in: the link is the key. Limited per IP, tighter than the
// app-wide default (calendar apps poll every few hours, a website loads the
// embed once a visit).
const PUBLIC_THROTTLE = { default: { limit: 60, ttl: 60_000 } };

/** Decision 319 item 4: a staff member's private calendar link. */
@ApiTags('schedule-sharing')
@Controller('calendar-feeds')
export class CalendarFeedsController {
  constructor(private readonly sharing: ScheduleSharingService) {}

  @Throttle(PUBLIC_THROTTLE)
  @ApiProduces('text/calendar')
  @Header('Cache-Control', 'private, max-age=300')
  @Get(':token')
  async feed(@Param('token') token: string, @Res() res: Response) {
    const ics = await this.sharing.calendarFor(token.replace(/\.ics$/, ''));
    if (ics === null) throw new NotFoundException('Calendar not found');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="classes.ics"');
    res.send(ics);
  }
}

/** Decision 319 item 4: the School's public schedule for its own website. */
@ApiTags('schedule-sharing')
@Controller('schedule-embeds')
export class ScheduleEmbedsController {
  constructor(private readonly sharing: ScheduleSharingService) {}

  @Throttle(PUBLIC_THROTTLE)
  @ApiOkResponse({ type: ScheduleEmbedDto })
  @Header('Cache-Control', 'public, max-age=300')
  @Get(':key')
  async json(@Param('key') key: string) {
    const found = await this.sharing.embedFor(key);
    if (!found) throw new NotFoundException('Schedule not found');
    return { ...found.school, classes: found.classes };
  }

  /** The page for an <iframe>: plain HTML, no script; any site may frame it. */
  @Throttle(PUBLIC_THROTTLE)
  @ApiProduces('text/html')
  @Get(':key/page')
  async page(@Param('key') key: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    const locale = embedLocale(typeof lang === 'string' ? lang : undefined);
    const found = await this.sharing.embedFor(key);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!found) {
      res.status(404).send(unavailablePage(locale));
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).send(schedulePage(locale, found.school, found.classes));
  }
}
