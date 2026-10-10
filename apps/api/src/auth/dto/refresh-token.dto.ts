import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/**
 * The raw token exactly as issued by login()/refresh() — never a lookup key a
 * client could guess or enumerate. No length/format regex: an unrecognized or
 * malformed value fails the same way at AuthService.lookupRefreshToken() (a
 * hash miss), so there's nothing extra a shape check would catch.
 */
export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
