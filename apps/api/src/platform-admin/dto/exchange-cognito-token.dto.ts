import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/** Request body for POST /platform-admin/auth/exchange. The frontend obtains this ID
 * token directly from Cognito's own Hosted UI + Authorization-Code-with-PKCE flow —
 * see CognitoTokenVerifierService's own header comment for why this backend never
 * participates in that exchange itself. */
export class ExchangeCognitoTokenDto {
  @ApiProperty({ description: "Cognito-issued ID token (JWT) from the frontend's own Hosted-UI/PKCE token exchange." })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
