import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PlatformAdminJwtAuthGuard } from '../platform-admin/guards/platform-admin-jwt-auth.guard';
import { CurrentAdminUser } from '../platform-admin/decorators/current-admin-user.decorator';
import { AdminJwtPayload } from '../platform-admin/interfaces/admin-jwt-payload.interface';
import { WhatsNewService } from './whats-new.service';
import { ProductUpdateAdminDto, ProductUpdateAdminListDto, WriteProductUpdateDto } from './dto/whats-new.dto';

/** Decision 318 item 3: ULTM8 HQ writes "What's new" in Platform Admin. Any
 * admin reads the posts; a Full Admin writes them (checked in the service),
 * and every change is audit-logged. Platform Admin's own realm and token. */
@ApiTags('platform-admin-whats-new')
@ApiBearerAuth()
@UseGuards(PlatformAdminJwtAuthGuard)
@Controller('platform-admin/whats-new')
export class PlatformAdminWhatsNewController {
  constructor(private readonly whatsNew: WhatsNewService) {}

  @ApiOkResponse({ type: ProductUpdateAdminListDto })
  @Get()
  list() {
    return this.whatsNew.listForAdmin();
  }

  @ApiCreatedResponse({ type: ProductUpdateAdminDto })
  @Post()
  create(@CurrentAdminUser() admin: AdminJwtPayload, @Body() dto: WriteProductUpdateDto) {
    return this.whatsNew.create(admin.sub, dto);
  }

  @ApiOkResponse({ type: ProductUpdateAdminDto })
  @Patch(':id')
  update(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WriteProductUpdateDto) {
    return this.whatsNew.update(admin.sub, id, dto);
  }

  @ApiNoContentResponse()
  @HttpCode(204)
  @Delete(':id')
  remove(@CurrentAdminUser() admin: AdminJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.whatsNew.remove(admin.sub, id);
  }
}
