import { useMutation } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RequestPublicPhotoUploadUrlInput = components['schemas']['RequestPublicPhotoUploadUrlDto'];
export type PublicPhotoEntityType = RequestPublicPhotoUploadUrlInput['entityType'];
export type PublicPhotoContentType = RequestPublicPhotoUploadUrlInput['contentType'];

/** Real photo uploads, product-owner-approved — see
 * apps/api/src/uploads/uploads.module.ts's own header comment. One shared
 * hook for `POST /uploads/public-photo-url`, reused across every
 * `PhotoUploadField` call site (`@ultm8/ui`) in this app — Instructor.photoUrl,
 * User.profilePhotoUrl, Branch/Franchise logoUrl/bannerUrl, Class.bannerUrl —
 * same "build the shared plumbing once" discipline the component itself
 * follows. Each call site builds its own `requestUpload` closure around this,
 * supplying that entity's own `entityType`/`schoolId`/`franchiseId`/`entityId`
 * — the backend enforces that entity's own existing authorization gate
 * server-side (see UploadsService.requestPublicPhotoUploadUrl's own comment),
 * never re-derived here. */
export function useRequestPublicPhotoUploadUrl() {
  return useMutation({
    mutationFn: (body: RequestPublicPhotoUploadUrlInput) =>
      unwrap(apiClient.POST('/v1/uploads/public-photo-url', { body })),
  });
}
