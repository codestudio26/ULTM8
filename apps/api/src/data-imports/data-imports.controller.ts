import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DataImportsService } from './data-imports.service';
import {
  DataImportResponseDto,
  ImportLimitsDto,
  ImportPreviewResponseDto,
  ImportRowsDto,
  ImportRowsResponseDto,
  PreviewImportDto,
  StartImportDto,
} from './dto/data-imports.dto';

/**
 * Students → Import (Decision 315 items 12 and 13; backlog 5.13): members,
 * memberships and past attendance from a spreadsheet. The owner, or Branch
 * Staff the owner switched on ("Import data"). See DataImportsService.
 */
@ApiTags('data-imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('schools/:schoolId/imports')
export class DataImportsController {
  constructor(private readonly imports: DataImportsService) {}

  /** The row limits and each kind's columns (for the templates). */
  @ApiOkResponse({ type: ImportLimitsDto })
  @Get('limits')
  limits(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string) {
    return this.imports.limits(user.sub, schoolId);
  }

  /** What importing these rows would do. Changes nothing. */
  @ApiCreatedResponse({ type: ImportPreviewResponseDto })
  @Post('preview')
  preview(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: PreviewImportDto) {
    return this.imports.preview(user.sub, schoolId, dto.kind, dto.rows);
  }

  /** Starts an import; send its rows with POST …/{importId}/rows. */
  @ApiCreatedResponse({ type: DataImportResponseDto })
  @Post()
  start(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Body() dto: StartImportDto) {
    return this.imports.start(user.sub, schoolId, dto);
  }

  /** Imports a batch of rows. A row sent again returns its first result. */
  @ApiCreatedResponse({ type: ImportRowsResponseDto })
  @Post(':importId/rows')
  importRows(
    @CurrentUser() user: JwtPayload,
    @Param('schoolId', ParseUUIDPipe) schoolId: string,
    @Param('importId', ParseUUIDPipe) importId: string,
    @Body() dto: ImportRowsDto,
  ) {
    return this.imports.importRows(user.sub, schoolId, importId, dto.rows);
  }

  /** An import's results so far. */
  @ApiOkResponse({ type: DataImportResponseDto })
  @Get(':importId')
  find(@CurrentUser() user: JwtPayload, @Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('importId', ParseUUIDPipe) importId: string) {
    return this.imports.find(user.sub, schoolId, importId);
  }
}
