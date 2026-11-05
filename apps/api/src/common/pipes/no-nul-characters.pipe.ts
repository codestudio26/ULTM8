import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** The message for a NUL character in a request (Decision 433, TXT-4). */
export const NUL_CHARACTER_MESSAGE = "Text can't contain a hidden NUL character. Remove it and try again.";

/** Whether `value` holds U+0000 in any string, at any depth. Buffers (a raw
 * webhook body, an uploaded file) are bytes, not text, and are skipped. */
export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (value === null || typeof value !== 'object' || depth > 32) return false;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Date) return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  return Object.entries(value).some(([k, v]) => k.includes('\u0000') || containsNul(v, depth + 1));
}

/**
 * Refuses a request whose body, query or route parameters hold a NUL
 * character (U+0000), with 400 INVALID_CHARACTER (Decision 433, TXT-4).
 * Postgres can't store NUL in text, so it used to fail with a 500 only at
 * the write, after a broadcast had already queued its notices. Registered as
 * APP_PIPE, so it runs for every route; custom parameters (the signed-in
 * user, an uploaded file) are not the caller's text and are left alone.
 */
@Injectable()
export class NoNulCharactersPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;
    if (containsNul(value)) throw new BadRequestException({ code: 'INVALID_CHARACTER', message: NUL_CHARACTER_MESSAGE });
    return value;
  }
}
