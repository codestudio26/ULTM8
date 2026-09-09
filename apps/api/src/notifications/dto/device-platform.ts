/**
 * Single source of truth for the DeviceToken.platform value set — found on
 * review to have already drifted within this same phase: the request DTO
 * typed it as the `'IOS' | 'ANDROID'` union, the response DTO typed the same
 * field as a bare `string`, and both independently hand-copied the
 * `@IsEnum`/Swagger `enum` array. Every DTO in this module imports this one
 * constant instead of re-declaring the value set.
 */
export const DEVICE_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];
