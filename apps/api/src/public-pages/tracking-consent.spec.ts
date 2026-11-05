import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import { schedulePage } from '../schedule-sharing/embed-page';
import { PUBLIC_PAGE_LOCALES } from './public-page-locale';
import {
  TRACKING_CONSENT_STORAGE_KEY,
  TRACKING_CONSENT_TEXTS,
  trackingConsent,
  trackingCsp,
  TrackingIds,
  validTrackingIds,
} from './tracking-consent';

const BOTH: TrackingIds = { metaPixelId: '123456789012345', googleAnalyticsId: 'G-AB12CD34EF' };
const THIRD_PARTY = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|facebook\.net|facebook\.com/;
const PAGE_URL = 'https://api.example.test/v1/schedule-embeds/key/page?lang=en';

/** Records every resource the page asks for, and serves nothing. */
class RecordingLoader extends ResourceLoader {
  requested: string[] = [];
  fetch(url: string) {
    this.requested.push(url);
    // jsdom aborts what is still loading when the window closes.
    return Object.assign(Promise.resolve(Buffer.from('')), { abort: () => undefined }) as ReturnType<ResourceLoader['fetch']>;
  }
}

/** Runs the page's script in a browser-like DOM. `stored` is this visit's
 * earlier choice in sessionStorage. */
function open(html: string, url: string, stored?: string) {
  const loader = new RecordingLoader();
  const navigations: string[] = [];
  const virtualConsole = new VirtualConsole();
  // jsdom doesn't navigate; it reports the attempt, which is what we check.
  virtualConsole.on('jsdomError', (e: Error) => navigations.push(e.message));
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: loader,
    virtualConsole,
    beforeParse(window) {
      if (stored) window.sessionStorage.setItem(TRACKING_CONSENT_STORAGE_KEY, stored);
    },
  });
  const doc = dom.window.document;
  const tagScripts = () => [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src') ?? '');
  return { dom, doc, loader, navigations, tagScripts, banner: () => doc.getElementById('ultm8-consent') as HTMLElement | null };
}

function embed(ids: TrackingIds, opts: { signUp?: boolean } = {}) {
  return schedulePage('en', { schoolName: 'Dojo', timezone: 'Europe/London' }, [], trackingConsent('en', ids, opts));
}

describe('Ad tracking behind cookie consent (Decision 318 item 10; Decision 435 items 24–27)', () => {
  describe('the IDs', () => {
    it('keeps only the exact saved formats: no Google Ads (AW-), no Tag Manager (GTM-), no markup', () => {
      expect(validTrackingIds(BOTH)).toEqual(BOTH);
      expect(validTrackingIds({ metaPixelId: '12345', googleAnalyticsId: 'AW-123456789' })).toEqual({ metaPixelId: null, googleAnalyticsId: null });
      expect(validTrackingIds({ metaPixelId: '1234567890"><script>', googleAnalyticsId: 'GTM-ABCD12' })).toEqual({ metaPixelId: null, googleAnalyticsId: null });
      expect(validTrackingIds(null)).toEqual({ metaPixelId: null, googleAnalyticsId: null });
    });

    it('a School without IDs gets no banner, no script, and the same strict policy as before', () => {
      const none = validTrackingIds(null);
      expect(trackingConsent('en', none)).toBeNull();
      expect(embed(none)).not.toContain('<script');
      expect(trackingCsp(none, null, true)).toBe("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'; form-action 'none'");
    });
  });

  describe('the banner', () => {
    it('is in all 15 languages and names only the services the School uses', () => {
      expect(PUBLIC_PAGE_LOCALES).toHaveLength(15);
      for (const locale of PUBLIC_PAGE_LOCALES) {
        const t = TRACKING_CONSENT_TEXTS[locale];
        for (const key of Object.keys(TRACKING_CONSENT_TEXTS.en) as Array<keyof typeof t>) expect([locale, key, t[key].length > 0]).toEqual([locale, key, true]);
        expect([locale, t.message.includes('{services}')]).toEqual([locale, true]);
        expect(trackingConsent(locale, BOTH)?.html).toContain(t.accept);
      }
      expect(trackingConsent('de', BOTH)?.html).toContain('Akzeptieren');
      const gaOnly = trackingConsent('en', { metaPixelId: null, googleAnalyticsId: 'G-AB12CD34EF' })!.html;
      expect(gaOnly).toContain('cookies from Google Analytics to count');
      expect(gaOnly).not.toContain('Meta Pixel');
    });
  });

  describe('the Content-Security-Policy', () => {
    it('before consent allows the one inline script by hash and no Meta or Google host', () => {
      const consent = trackingConsent('en', BOTH)!;
      const csp = trackingCsp(BOTH, consent, false);
      expect(csp).toContain(`script-src ${consent.scriptSource}`);
      expect(csp).not.toMatch(THIRD_PARTY);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      expect(csp).toContain("default-src 'none'");
    });

    it("after Accept allows only the exact hosts the School's IDs need", () => {
      const ga = { metaPixelId: null, googleAnalyticsId: 'G-AB12CD34EF' };
      const gaCsp = trackingCsp(ga, trackingConsent('en', ga), true);
      expect(gaCsp).toContain('script-src');
      expect(gaCsp).toContain('https://www.googletagmanager.com');
      expect(gaCsp).toContain('https://region1.google-analytics.com');
      expect(gaCsp).not.toContain('facebook');
      expect(gaCsp.replace('frame-ancestors *', '')).not.toContain('*');
      const meta = { metaPixelId: '123456789012345', googleAnalyticsId: null };
      const metaCsp = trackingCsp(meta, trackingConsent('en', meta), true);
      expect(metaCsp).toMatch(/script-src [^;]*https:\/\/connect\.facebook\.net/);
      expect(metaCsp).toMatch(/img-src https:\/\/www\.facebook\.com/);
      expect(metaCsp).not.toContain('google');
      // frame-ancestors * is the embed's own rule; no source list uses a wildcard.
      expect(metaCsp.replace('frame-ancestors *', '')).not.toContain('*');
    });

    it('the hash matches the script actually on the page', () => {
      const consent = trackingConsent('en', BOTH)!;
      const js = /<script>([\s\S]*)<\/script>/.exec(consent.html)![1];
      const { createHash } = jest.requireActual<typeof import('crypto')>('crypto');
      expect(consent.scriptSource).toBe(`'sha256-${createHash('sha256').update(js, 'utf8').digest('base64')}'`);
    });
  });

  describe('in the page', () => {
    it('before any choice: shows the banner and loads nothing third-party', async () => {
      const page = open(embed(BOTH), PAGE_URL);
      await new Promise((r) => setTimeout(r, 20));
      expect(page.banner()?.hidden).toBe(false);
      expect(page.tagScripts()).toEqual([]);
      expect(page.loader.requested).toEqual([]);
      expect(page.dom.window.document.cookie).toBe('');
      expect((page.dom.window as unknown as { gtag?: unknown }).gtag).toBeUndefined();
      expect((page.dom.window as unknown as { fbq?: unknown }).fbq).toBeUndefined();
      page.dom.window.close();
    });

    it('even on the ?tracking=on address, nothing loads without this visit’s Accept', async () => {
      const page = open(embed(BOTH), `${PAGE_URL}&tracking=on`);
      await new Promise((r) => setTimeout(r, 20));
      expect(page.banner()?.hidden).toBe(false);
      expect(page.tagScripts()).toEqual([]);
      expect(page.loader.requested).toEqual([]);
      page.dom.window.close();
    });

    it('Decline: the banner goes, nothing loads, and the choice holds for the visit', async () => {
      const page = open(embed(BOTH), PAGE_URL);
      (page.doc.getElementById('ultm8-consent-decline') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 20));
      expect(page.banner()?.hidden).toBe(true);
      expect(page.dom.window.sessionStorage.getItem(TRACKING_CONSENT_STORAGE_KEY)).toBe('declined');
      expect(page.tagScripts()).toEqual([]);
      expect(page.loader.requested).toEqual([]);
      page.dom.window.close();
      const next = open(embed(BOTH), PAGE_URL, 'declined');
      expect(next.banner()?.hidden).toBe(true);
      expect(next.tagScripts()).toEqual([]);
      next.dom.window.close();
    });

    it('Accept: remembered for this visit only, then the page reloads to the address that allows the tags', async () => {
      const page = open(embed(BOTH), PAGE_URL);
      (page.doc.getElementById('ultm8-consent-accept') as HTMLButtonElement).click();
      expect(page.dom.window.sessionStorage.getItem(TRACKING_CONSENT_STORAGE_KEY)).toBe('accepted');
      expect(page.dom.window.localStorage.length).toBe(0);
      expect(page.dom.window.document.cookie).toBe('');
      expect(page.navigations.some((m) => /navigation/i.test(m))).toBe(true);
      expect(page.tagScripts()).toEqual([]);
      page.dom.window.close();
    });

    it('after Accept, on the allowed address: loads Google Analytics and the Meta Pixel with a page view', async () => {
      const page = open(embed(BOTH), `${PAGE_URL}&tracking=on`, 'accepted');
      await new Promise((r) => setTimeout(r, 20));
      expect(page.banner()?.hidden).toBe(true);
      expect(page.tagScripts()).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF', 'https://connect.facebook.net/en_US/fbevents.js']);
      expect(page.loader.requested).toEqual(['https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF', 'https://connect.facebook.net/en_US/fbevents.js']);
      const w = page.dom.window as unknown as { dataLayer: IArguments[]; fbq: { queue: IArguments[] } };
      const gaCalls = w.dataLayer.map((a) => [...a]);
      expect(gaCalls[1]).toEqual(['config', 'G-AB12CD34EF', { allow_google_signals: false, allow_ad_personalization_signals: false, page_location: 'https://api.example.test/v1/schedule-embeds/key/page' }]);
      const metaCalls = w.fbq.queue.map((a) => [...a]);
      expect(metaCalls).toEqual([
        ['set', 'autoConfig', false, '123456789012345'],
        ['init', '123456789012345'],
        ['track', 'PageView'],
      ]);
      // The embed never fires the sign-up event.
      expect(JSON.stringify(gaCalls)).not.toContain('sign_up');
      page.dom.window.close();
    });

    it('accepted earlier in the visit, on the plain address: reloads to the allowed address without loading anything first', async () => {
      const page = open(embed(BOTH), PAGE_URL, 'accepted');
      await new Promise((r) => setTimeout(r, 20));
      expect(page.navigations.some((m) => /navigation/i.test(m))).toBe(true);
      expect(page.tagScripts()).toEqual([]);
      expect(page.loader.requested).toEqual([]);
      page.dom.window.close();
    });

    it('the sign-up event hook: a no-op before consent, and fired after Accept only by a page that asks for it', async () => {
      const before = open(embed(BOTH, { signUp: true }), PAGE_URL);
      (before.dom.window as unknown as { ultm8Track: (n: string) => void }).ultm8Track('sign_up');
      expect(before.tagScripts()).toEqual([]);
      before.dom.window.close();

      const page = open(embed(BOTH, { signUp: true }), `${PAGE_URL}&tracking=on`, 'accepted');
      const w = page.dom.window as unknown as { dataLayer: IArguments[]; fbq: { queue: IArguments[] } };
      expect(w.dataLayer.map((a) => [...a])).toContainEqual(['event', 'sign_up']);
      expect(w.fbq.queue.map((a) => [...a])).toContainEqual(['track', 'CompleteRegistration']);
      page.dom.window.close();
    });
  });

  describe('where the tags may load', () => {
    it('no other app or API file names a Meta or Google tag host: not the portal, sign-in, waivers, payments or the member app', () => {
      const repo = join(__dirname, '..', '..', '..', '..');
      const allowed = new Set(['apps/api/src/public-pages/tracking-consent.ts', 'apps/api/src/public-pages/tracking-consent.spec.ts']);
      const roots = ['apps/api/src', 'apps/school-portal', 'apps/platform-admin', 'apps/student', 'packages/ui/src'];
      const skip = new Set(['node_modules', 'generated', 'dist', 'build', 'coverage', 'playwright-report', 'test-results', '.expo']);
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          if (skip.has(name)) continue;
          const path = join(dir, name);
          if (statSync(path).isDirectory()) walk(path);
          else if (/\.(ts|tsx|js|jsx|html)$/.test(name)) {
            const rel = relative(repo, path).split('\\').join('/');
            if (!allowed.has(rel) && /googletagmanager\.com|connect\.facebook\.net|google-analytics\.com|facebook\.com\/tr|fbevents/.test(readFileSync(path, 'utf8'))) offenders.push(rel);
          }
        }
      };
      for (const root of roots) {
        try {
          if (statSync(join(repo, root)).isDirectory()) walk(join(repo, root));
        } catch {
          // An app missing from this checkout has nothing to scan.
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
