/**
 * The 15 languages of the apps, for the School's own public pages that the
 * API serves (today the schedule embed; later the website sign-up form and its
 * thank-you page). English when none or another is asked.
 */
export const PUBLIC_PAGE_LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'zh-CN'] as const;
export type PublicPageLocale = (typeof PUBLIC_PAGE_LOCALES)[number];

export function publicPageLocale(lang: string | undefined): PublicPageLocale {
  const found = PUBLIC_PAGE_LOCALES.find((l) => l.toLowerCase() === (lang ?? '').toLowerCase());
  return found ?? 'en';
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
