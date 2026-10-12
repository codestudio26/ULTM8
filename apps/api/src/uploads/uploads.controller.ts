import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UploadsService } from './uploads.service';
import { RequestPublicPhotoUploadUrlDto } from './dto/request-public-photo-upload-url.dto';
import { PublicPhotoUploadUrlResponseDto } from './dto/public-photo-upload-url-response.dto';

/** One shared presign endpoint for every real photo/logo/banner upload app-wide
 * — see UploadsModule's own header comment. */
@ApiTags('uploads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @ApiCreatedResponse({ type: PublicPhotoUploadUrlResponseDto })
  @Post('public-photo-url')
  requestPublicPhotoUploadUrl(@CurrentUser() user: JwtPayload, @Body() dto: RequestPublicPhotoUploadUrlDto) {
    return this.uploadsService.requestPublicPhotoUploadUrl(user.sub, dto);
  }
}
