import type { components } from '@ultm8/api-client';
import type { TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

export type MembershipCard = components['schemas']['MembershipCardDto'];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Only an http(s) address goes into an <img>. */
function safeUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** One line per membership in effect now: its name, then classes left or the end date. */
export function membershipLines(t: TranslateFn, card: MembershipCard): string[] {
  if (card.memberships.length === 0) return [t('frontDesk.card.noMembership')];
  return card.memberships.map((m) => {
    if (m.classesRemaining !== null && m.classesRemaining !== undefined) return `${m.title} · ${t('frontDesk.card.classesLeft', { count: m.classesRemaining })}`;
    if (m.expiryDate) return `${m.title} · ${t('frontDesk.card.until', { date: new Date(m.expiryDate).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) })}`;
    return m.title;
  });
}

/**
 * A printable membership card (backlog 3.11, Decision 398), the size of a bank
 * card: the School, the student's photo and name, their check-in code and
 * their memberships. It has no QR code: a printed one would never change, so a
 * copy could check anyone in. The app shows the live QR instead.
 */
export function membershipCardHtml(t: TranslateFn, card: MembershipCard): string {
  const name = `${card.firstName} ${card.surname}`.trim();
  const logo = safeUrl(card.schoolLogoUrl);
  const photo = safeUrl(card.photoUrl);
  const initials = `${card.firstName.charAt(0)}${card.surname.charAt(0)}`.toUpperCase();
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<title>${esc(t('frontDesk.card.pageTitle', { name }))}</title>` +
    '<style>body{font-family:system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;margin:40px;color:#151719}' +
    '.card{width:85.6mm;height:54mm;box-sizing:border-box;border:1px solid #c9ced3;border-radius:3.2mm;padding:4mm;display:flex;flex-direction:column;gap:2.5mm;overflow:hidden}' +
    '.school{display:flex;align-items:center;gap:2mm;font-weight:700;font-size:11pt}.school img{height:7mm;max-width:20mm;object-fit:contain}' +
    '.who{display:flex;gap:3mm;align-items:center}.photo{width:16mm;height:16mm;border-radius:50%;object-fit:cover;background:#e8ebee;display:flex;align-items:center;justify-content:center;font-weight:700;color:#50575e;flex:none}' +
    '.name{font-size:12pt;font-weight:700}.label{font-size:7pt;text-transform:uppercase;letter-spacing:.06em;color:#50575e}' +
    '.code{font-size:15pt;letter-spacing:.2em;font-variant-numeric:tabular-nums;font-weight:600}.plans{font-size:8pt;color:#33393f;margin:0;padding:0;list-style:none}' +
    'button{margin-top:24px;padding:10px 16px;border-radius:8px;border:1px solid #5d7081;background:#5d7081;color:#fff;font-weight:600;cursor:pointer}' +
    '@media print{button{display:none}body{margin:0}}</style></head><body>' +
    '<div class="card">' +
    `<div class="school">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(card.schoolName)}</span></div>` +
    '<div class="who">' +
    (photo ? `<img class="photo" src="${esc(photo)}" alt="">` : `<div class="photo">${esc(initials)}</div>`) +
    `<div><div class="name">${esc(name)}</div><div class="label">${esc(t('frontDesk.card.codeLabel'))}</div><div class="code">${esc(card.checkInCode)}</div></div>` +
    '</div>' +
    `<ul class="plans">${membershipLines(t, card).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` +
    '</div>' +
    `<button onclick="window.print()">${esc(t('frontDesk.card.printButton'))}</button></body></html>`
  );
}
