import { ServiceUnavailableException } from '@nestjs/common';
import { R2ClientService, STORAGE_NOT_SET_UP } from './r2-client.service';

/** Without R2 settings, a photo upload answers 503 "File storage isn't set up
 * yet" (translated in the portals), not a 500 "Internal server error". */
describe('R2ClientService without R2 settings', () => {
  const R2_VARS = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_BUCKET_NAME',
    'R2_PUBLIC_BASE_URL',
  ];
  const saved: Record<string, string | undefined> = {};
  let r2: R2ClientService;

  beforeEach(() => {
    for (const name of R2_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
    r2 = new R2ClientService();
  });

  afterEach(() => {
    for (const name of R2_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('a photo upload link is a 503 with the "not set up" message', async () => {
    const attempt = r2.getPublicPhotoUploadUrl('branches/x.png', 'image/png');
    await expect(attempt).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(r2.getPublicPhotoUploadUrl('branches/x.png', 'image/png')).rejects.toThrow(STORAGE_NOT_SET_UP);
  });

  it('a private upload or download link is the same 503', async () => {
    await expect(r2.getPresignedUploadUrl('certs/x.pdf', 'application/pdf')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(r2.getPresignedDownloadUrl('certs/x.pdf')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('a public photo address is the same 503', () => {
    expect(() => r2.getPublicPhotoUrl('branches/x.png')).toThrow(ServiceUnavailableException);
  });
});
