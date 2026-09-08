import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { LANGUAGES } from './constants/languages';
import { CURRENCIES } from './constants/currencies';

@Injectable()
export class SettingsService {
  constructor(private readonly prismaApp: PrismaAppService) {}

  getLanguages() {
    return LANGUAGES;
  }

  getCurrencies() {
    return CURRENCIES;
  }

  /**
   * Queried directly on the bare `PrismaAppService` client, NOT through
   * `withTenantContext` — checked directly against that helper's own
   * implementation before writing this: it requires a real UUID `userId` (it SET
   * LOCALs `app.current_user_id` for RLS to read) and throws
   * ("Refusing to set tenant context to non-UUID value") on anything else. This is
   * a public, unauthenticated route with no caller id to give it. Since
   * `LegalDocument` carries no RLS in the first place (see its own schema.prisma
   * comment), there is no tenant context to establish here — this is the correct
   * call, not a shortcut around the "every tenant-scoped query MUST go through
   * withTenantContext" rule, which `PrismaAppService`'s own header comment scopes
   * specifically to tenant-scoped queries. This is the first call site in this
   * codebase to query the bare client this way (grep confirms it) — a new pattern
   * reasoned correctly from first principles here, not one following an
   * already-established precedent for how a no-RLS table gets queried (see
   * schema.prisma's own LegalDocument comment for why AdminUser doesn't actually
   * supply that precedent, despite an earlier draft of these comments claiming it did).
   */
  async getLegalDocument(slug: string) {
    const found = await this.prismaApp.legalDocument.findUnique({ where: { slug } });
    if (!found) {
      throw new NotFoundException('Legal document not found');
    }
    return found;
  }
}
