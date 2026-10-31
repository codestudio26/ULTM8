import { BadGatewayException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { countryName } from '../common/address/postal-address.dto';
import { formatPostalAddress, validatePostalAddress } from '../common/address/postal-address';
import { mapGooglePlaceToPostalAddress, type GooglePlaceDetails } from './google-address-mapping';
import { PLACES_HTTP, type PlacesHttp, type PlacesHttpResponse } from './places-http';
import type {
  AddressAutocompleteQueryDto,
  AddressAutocompleteResponseDto,
  AddressDetailsQueryDto,
  AddressDetailsResponseDto,
  AddressLookupStatusDto,
} from './dto/address-lookup.dto';

const PLACES_BASE = 'https://places.googleapis.com/v1';
/** Short: a person is waiting on each keystroke. */
const AUTOCOMPLETE_TIMEOUT_MS = 3_000;
const DETAILS_TIMEOUT_MS = 5_000;
/** Only the address fields, so the request stays on Google's Place Details Essentials price. */
const DETAILS_FIELD_MASK = 'id,formattedAddress,adrFormatAddress,addressComponents';
const MAX_SUGGESTIONS = 5;

interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    };
  }>;
}

/**
 * Google Places street lookup (Decision 212; built in v1.3 per Decision 267).
 *
 * A server-side proxy so the Google API key never reaches a browser or the
 * mobile app. Switched off until `GOOGLE_PLACES_API_KEY` is set: `status()`
 * says `enabled: false`, the apps hide the search box and show the plain
 * address fields, and the lookup calls answer 503 ADDRESS_LOOKUP_NOT_CONFIGURED.
 *
 * The key is read on every call (not cached at start-up) and only ever sent in
 * the `X-Goog-Api-Key` header — never in a URL, and never logged.
 */
@Injectable()
export class AddressLookupService {
  private readonly logger = new Logger(AddressLookupService.name);

  constructor(@Inject(PLACES_HTTP) private readonly http: PlacesHttp) {}

  private apiKey(): string | undefined {
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    return key ? key : undefined;
  }

  status(): AddressLookupStatusDto {
    return { enabled: Boolean(this.apiKey()) };
  }

  private requireKey(): string {
    const key = this.apiKey();
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'ADDRESS_LOOKUP_NOT_CONFIGURED',
        message: "Address search isn't set up yet. Enter the address in the fields instead.",
      });
    }
    return key;
  }

  async autocomplete(query: AddressAutocompleteQueryDto, acceptLanguage?: string): Promise<AddressAutocompleteResponseDto> {
    const key = this.requireKey();
    const language = query.language ?? languageFromHeader(acceptLanguage);
    const body: Record<string, unknown> = { input: query.q };
    if (query.country) body.includedRegionCodes = [query.country.toLowerCase()];
    if (language) body.languageCode = language;
    if (query.sessionToken) body.sessionToken = query.sessionToken;

    const res = await this.send('autocomplete', {
      method: 'POST',
      url: `${PLACES_BASE}/places:autocomplete`,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
      body: JSON.stringify(body),
      timeoutMs: AUTOCOMPLETE_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) throw this.upstreamFailure('autocomplete', res.status);
    const parsed = parseJson<GoogleAutocompleteResponse>(res.body, 'autocomplete', this.logger);
    const suggestions = (parsed.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .slice(0, MAX_SUGGESTIONS)
      .map((p) => {
        const mainText = p.structuredFormat?.mainText?.text ?? p.text?.text ?? '';
        const secondaryText = p.structuredFormat?.secondaryText?.text ?? '';
        return {
          placeId: p.placeId!,
          text: p.text?.text ?? [mainText, secondaryText].filter(Boolean).join(', '),
          mainText,
          secondaryText,
        };
      });
    return { suggestions };
  }

  async details(query: AddressDetailsQueryDto, acceptLanguage?: string): Promise<AddressDetailsResponseDto> {
    const key = this.requireKey();
    const language = query.language ?? languageFromHeader(acceptLanguage);
    const params = new URLSearchParams();
    if (language) params.set('languageCode', language);
    if (query.sessionToken) params.set('sessionToken', query.sessionToken);
    const qs = params.toString();

    const res = await this.send('details', {
      method: 'GET',
      url: `${PLACES_BASE}/places/${encodeURIComponent(query.placeId)}${qs ? `?${qs}` : ''}`,
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      timeoutMs: DETAILS_TIMEOUT_MS,
    });
    if (res.status === 400 || res.status === 404) {
      throw new NotFoundException({ code: 'ADDRESS_LOOKUP_PLACE_NOT_FOUND', message: 'That address could not be found. Try searching again.' });
    }
    if (res.status < 200 || res.status >= 300) throw this.upstreamFailure('details', res.status);
    const place = parseJson<GooglePlaceDetails>(res.body, 'details', this.logger);
    const postalAddress = mapGooglePlaceToPostalAddress(place);
    return {
      placeId: place.id ?? query.placeId,
      postalAddress,
      formattedAddress: postalAddress.country ? formatPostalAddress(postalAddress, countryName(postalAddress.country)) : place.formattedAddress ?? '',
      complete: Object.keys(validatePostalAddress(postalAddress)).length === 0 && Boolean(postalAddress.line1),
    };
  }

  private async send(what: string, req: Parameters<PlacesHttp>[0]): Promise<PlacesHttpResponse> {
    try {
      return await this.http(req);
    } catch (err) {
      // The error is from the network layer (timeout, DNS, proxy) and never holds the key.
      this.logger.warn(`Google Places ${what} request failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      throw new BadGatewayException({ code: 'ADDRESS_LOOKUP_FAILED', message: "Address search isn't working right now. Enter the address in the fields instead." });
    }
  }

  private upstreamFailure(what: string, status: number): BadGatewayException {
    // Status only: Google's error body can echo request details.
    this.logger.warn(`Google Places ${what} answered HTTP ${status}`);
    return new BadGatewayException({ code: 'ADDRESS_LOOKUP_FAILED', message: "Address search isn't working right now. Enter the address in the fields instead." });
  }
}

function parseJson<T>(body: string, what: string, logger: Logger): T {
  try {
    const value = JSON.parse(body) as unknown;
    return (value && typeof value === 'object' ? value : {}) as T;
  } catch {
    logger.warn(`Google Places ${what} returned a body that isn't JSON`);
    throw new BadGatewayException({ code: 'ADDRESS_LOOKUP_FAILED', message: "Address search isn't working right now. Enter the address in the fields instead." });
  }
}

/** The first language in an Accept-Language header ("pt-BR,pt;q=0.9" → "pt-BR"), if it looks like one. */
export function languageFromHeader(header: string | undefined): string | undefined {
  const tag = header?.split(',')[0]?.split(';')[0]?.trim();
  return tag && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : undefined;
}
