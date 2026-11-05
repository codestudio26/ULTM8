import { createHash } from 'crypto';
import { GOOGLE_ANALYTICS_ID_PATTERN, META_PIXEL_ID_PATTERN } from '../tenants/schools/dto/update-school.dto';
import { escapeHtml, PublicPageLocale } from './public-page-locale';

/**
 * Decision 318 item 10, as answered on 5 Nov 2026 (Decision 435 items 24–27):
 * the School's Meta Pixel and Google Analytics tags, on the School's own
 * public pages only, behind a cookie-consent banner.
 *
 * Shared by every public page the API serves for a School. Today that is the
 * schedule embed (`schedule-sharing/embed-page.ts`); the website sign-up form
 * and its thank-you page will reuse it when they exist (the thank-you page
 * passes `signUp: true`). Never used by the portal, sign-in, waivers,
 * payments or the member app: those are other apps and never import this.
 *
 * How nothing loads before consent, twice over:
 * 1. The page is served with a Content-Security-Policy that names no Meta or
 *    Google host at all, so the browser itself refuses any request to them.
 * 2. The page's one inline script (allowed by its hash, nothing else) adds
 *    the tags only after the visitor clicks Accept. Accept remembers the
 *    choice for this visit (the tab's sessionStorage) and reloads the page
 *    with `?tracking=on`; only that address is served with a policy naming
 *    the exact Meta/Google hosts the saved IDs need, and even there the tags
 *    load only if this visit's stored choice says Accept (the address alone
 *    is not consent). Decline is remembered for the visit too. Nothing is
 *    kept after the tab closes, so the banner asks again on the next visit.
 *
 * What is tracked: a page view, and one "sign-up" event that only a page
 * calling for it fires (never the embed). No personal data: the tags get no
 * name, email or member detail; the address sent to Google is the page's own
 * address without its query; Google signals, ad personalisation and Meta's
 * automatic event setup (which reads the page's buttons) are off.
 *
 * IDs are checked again against the same strict formats as the School form
 * (UpdateSchoolDto and the database CHECKs), so only digits, or "G-" and
 * capitals and digits, ever reach a page. Google Ads (AW-) and Tag Manager
 * (GTM-) IDs never match, so they never load.
 */

export interface TrackingIds {
  metaPixelId: string | null;
  googleAnalyticsId: string | null;
}

/** The query value that asks for the page with the tag hosts allowed. */
export const TRACKING_QUERY_PARAM = 'tracking';
export const TRACKING_QUERY_ON = 'on';

/** This visit's choice, in the tab's sessionStorage. */
export const TRACKING_CONSENT_STORAGE_KEY = 'ultm8-tracking-consent';

/** The exact hosts each tag needs, per Meta's and Google's own CSP guidance. */
export const GOOGLE_ANALYTICS_HOSTS = {
  script: ['https://www.googletagmanager.com'],
  connect: [
    'https://www.google-analytics.com',
    'https://region1.google-analytics.com',
    'https://analytics.google.com',
    'https://region1.analytics.google.com',
    'https://www.googletagmanager.com',
  ],
  img: ['https://www.google-analytics.com', 'https://www.googletagmanager.com'],
};
export const META_PIXEL_HOSTS = {
  script: ['https://connect.facebook.net'],
  connect: ['https://www.facebook.com'],
  img: ['https://www.facebook.com'],
};

export interface TrackingConsentTexts {
  label: string;
  message: string;
  accept: string;
  decline: string;
}

export const TRACKING_CONSENT_TEXTS: Record<PublicPageLocale, TrackingConsentTexts> = {
  en: { label: 'Cookie consent', message: 'With your permission, this School uses cookies from {services} to count visits to this page. Nothing is loaded unless you accept.', accept: 'Accept', decline: 'Decline' },
  ar: { label: 'الموافقة على ملفات تعريف الارتباط', message: 'بإذنك، تستخدم هذه المدرسة ملفات تعريف الارتباط من {services} لإحصاء زيارات هذه الصفحة. لا يتم تحميل أي شيء ما لم توافق.', accept: 'قبول', decline: 'رفض' },
  de: { label: 'Cookie-Einwilligung', message: 'Mit Ihrer Zustimmung verwendet diese Schule Cookies von {services}, um Besuche dieser Seite zu zählen. Ohne Ihre Zustimmung wird nichts geladen.', accept: 'Akzeptieren', decline: 'Ablehnen' },
  es: { label: 'Consentimiento de cookies', message: 'Con tu permiso, esta escuela usa cookies de {services} para contar las visitas a esta página. No se carga nada a menos que aceptes.', accept: 'Aceptar', decline: 'Rechazar' },
  fr: { label: 'Consentement aux cookies', message: 'Avec votre accord, cette école utilise des cookies de {services} pour compter les visites de cette page. Rien n’est chargé sans votre accord.', accept: 'Accepter', decline: 'Refuser' },
  it: { label: 'Consenso ai cookie', message: 'Con il tuo consenso, questa scuola usa i cookie di {services} per contare le visite a questa pagina. Non viene caricato nulla se non accetti.', accept: 'Accetta', decline: 'Rifiuta' },
  ja: { label: 'Cookie の同意', message: 'お客様の同意がある場合に限り、このスクールは {services} の Cookie を使ってこのページの訪問数を計測します。同意しない限り何も読み込まれません。', accept: '同意する', decline: '拒否する' },
  ko: { label: '쿠키 동의', message: '동의하시면 이 학교는 {services} 쿠키를 사용해 이 페이지의 방문 수를 집계합니다. 동의하지 않으면 아무것도 불러오지 않습니다.', accept: '동의', decline: '거부' },
  nl: { label: 'Cookietoestemming', message: 'Met uw toestemming gebruikt deze school cookies van {services} om bezoeken aan deze pagina te tellen. Er wordt niets geladen tenzij u accepteert.', accept: 'Accepteren', decline: 'Weigeren' },
  pl: { label: 'Zgoda na pliki cookie', message: 'Za Twoją zgodą ta szkoła używa plików cookie {services}, aby liczyć odwiedziny tej strony. Nic nie zostanie wczytane bez Twojej zgody.', accept: 'Akceptuję', decline: 'Odrzucam' },
  'pt-BR': { label: 'Consentimento de cookies', message: 'Com sua permissão, esta escola usa cookies de {services} para contar as visitas a esta página. Nada é carregado a menos que você aceite.', accept: 'Aceitar', decline: 'Recusar' },
  ru: { label: 'Согласие на файлы cookie', message: 'С вашего согласия эта школа использует файлы cookie {services}, чтобы считать посещения этой страницы. Без вашего согласия ничего не загружается.', accept: 'Принять', decline: 'Отклонить' },
  th: { label: 'การยินยอมคุกกี้', message: 'เมื่อคุณอนุญาต โรงเรียนนี้จะใช้คุกกี้ของ {services} เพื่อนับจำนวนการเข้าชมหน้านี้ จะไม่มีการโหลดสิ่งใดจนกว่าคุณจะยอมรับ', accept: 'ยอมรับ', decline: 'ปฏิเสธ' },
  tr: { label: 'Çerez onayı', message: 'İzninizle bu okul, bu sayfanın ziyaretlerini saymak için {services} çerezlerini kullanır. Siz kabul etmedikçe hiçbir şey yüklenmez.', accept: 'Kabul et', decline: 'Reddet' },
  'zh-CN': { label: 'Cookie 同意', message: '经您同意后，本学校会使用 {services} 的 Cookie 统计本页面的访问量。除非您接受，否则不会加载任何内容。', accept: '接受', decline: '拒绝' },
};

/** Only IDs in the exact saved formats; anything else is dropped. */
export function validTrackingIds(raw: { metaPixelId?: string | null; googleAnalyticsId?: string | null } | null | undefined): TrackingIds {
  const pixel = raw?.metaPixelId ?? null;
  const ga = raw?.googleAnalyticsId ?? null;
  return {
    metaPixelId: typeof pixel === 'string' && META_PIXEL_ID_PATTERN.test(pixel) ? pixel : null,
    googleAnalyticsId: typeof ga === 'string' && GOOGLE_ANALYTICS_ID_PATTERN.test(ga) ? ga : null,
  };
}

export function hasTracking(ids: TrackingIds): boolean {
  return ids.metaPixelId !== null || ids.googleAnalyticsId !== null;
}

export interface TrackingConsent {
  /** CSS for the <head>. */
  style: string;
  /** The banner (hidden until the script decides) and the one inline script. */
  html: string;
  /** The CSP source that allows the inline script, e.g. 'sha256-…'. */
  scriptSource: string;
}

const STYLE = `.ultm8-consent{margin:0 0 8px;padding:10px 16px;background:#f6f8fa;border-bottom:1px solid #d0d7de;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.ultm8-consent[hidden]{display:none}
.ultm8-consent p{margin:0;flex:1 1 260px}
.ultm8-consent button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #57606a;background:#fff;color:#1f2328;cursor:pointer}
@media (prefers-color-scheme:dark){.ultm8-consent{background:#161b22;border-color:#30363d}.ultm8-consent button{background:#0d1117;color:#e6edf3;border-color:#8b949e}}`;

/**
 * The script. Plain ES5, no template from the School: the only values in it
 * are the two IDs (already matched against digit/letter-only formats and
 * JSON-encoded) and a boolean.
 */
function script(ids: TrackingIds, signUp: boolean): string {
  const config = JSON.stringify({ ga: ids.googleAnalyticsId, meta: ids.metaPixelId, signUp });
  return [
    '(function(){',
    `var C=${config};`,
    `var KEY=${JSON.stringify(TRACKING_CONSENT_STORAGE_KEY)};`,
    'function get(){try{return window.sessionStorage.getItem(KEY)}catch(e){return null}}',
    'function set(v){try{window.sessionStorage.setItem(KEY,v);return true}catch(e){return false}}',
    'function add(src){var s=document.createElement("script");s.async=true;s.src=src;document.head.appendChild(s)}',
    `var q=new URLSearchParams(window.location.search);var allowed=q.get(${JSON.stringify(TRACKING_QUERY_PARAM)})===${JSON.stringify(TRACKING_QUERY_ON)};`,
    `function go(){q.set(${JSON.stringify(TRACKING_QUERY_PARAM)},${JSON.stringify(TRACKING_QUERY_ON)});window.location.replace(window.location.pathname+"?"+q.toString())}`,
    'window.ultm8Track=function(){};',
    'function load(){',
    'if(C.ga){window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};',
    'window.gtag("js",new Date());',
    'window.gtag("config",C.ga,{allow_google_signals:false,allow_ad_personalization_signals:false,page_location:window.location.origin+window.location.pathname});',
    'add("https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(C.ga))}',
    'if(C.meta){var f=window.fbq=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};',
    'if(!window._fbq)window._fbq=f;f.push=f;f.loaded=true;f.version="2.0";f.queue=[];',
    'f("set","autoConfig",false,C.meta);f("init",C.meta);f("track","PageView");',
    'add("https://connect.facebook.net/en_US/fbevents.js")}',
    'window.ultm8Track=function(name){if(name!=="sign_up")return;if(C.ga&&window.gtag)window.gtag("event","sign_up");if(C.meta&&window.fbq)window.fbq("track","CompleteRegistration")};',
    'if(C.signUp)window.ultm8Track("sign_up")}',
    'var b=document.getElementById("ultm8-consent");var choice=get();',
    'if(choice==="accepted"){if(allowed)load();else go()}',
    'else if(choice!=="declined"&&b){b.hidden=false}',
    'if(b){',
    'document.getElementById("ultm8-consent-accept").addEventListener("click",function(){b.hidden=true;if(set("accepted"))go()});',
    'document.getElementById("ultm8-consent-decline").addEventListener("click",function(){b.hidden=true;set("declined")})}',
    '})();',
  ].join('');
}

/**
 * The banner and script for a page, or null when the School has no valid ID
 * (then the page carries no script and no banner at all). `signUp` fires the
 * one sign-up event after Accept: for the future thank-you page only.
 */
export function trackingConsent(locale: PublicPageLocale, ids: TrackingIds, opts: { signUp?: boolean } = {}): TrackingConsent | null {
  if (!hasTracking(ids)) return null;
  const t = TRACKING_CONSENT_TEXTS[locale];
  const services = [ids.googleAnalyticsId ? 'Google Analytics' : null, ids.metaPixelId ? 'Meta Pixel' : null].filter(Boolean).join(', ');
  const js = script(ids, opts.signUp === true);
  const hash = createHash('sha256').update(js, 'utf8').digest('base64');
  const html =
    `<div class="ultm8-consent" id="ultm8-consent" role="region" aria-label="${escapeHtml(t.label)}" hidden>` +
    `<p>${escapeHtml(t.message.replace('{services}', services))}</p>` +
    `<button type="button" id="ultm8-consent-accept">${escapeHtml(t.accept)}</button>` +
    `<button type="button" id="ultm8-consent-decline">${escapeHtml(t.decline)}</button>` +
    `</div><script>${js}</script>`;
  return { style: STYLE, html, scriptSource: `'sha256-${hash}'` };
}

/**
 * The page's Content-Security-Policy. Without tracking, unchanged from before
 * (no script at all). With tracking: the inline script by its hash; the Meta
 * and Google hosts only on the `?tracking=on` address the script reloads to
 * after Accept, and only those the School's saved IDs need.
 */
export function trackingCsp(ids: TrackingIds, consent: TrackingConsent | null, tagHostsAllowed: boolean): string {
  const script: string[] = [];
  const connect: string[] = [];
  const img: string[] = [];
  if (consent) {
    script.push(consent.scriptSource);
    if (tagHostsAllowed) {
      for (const hosts of [ids.googleAnalyticsId ? GOOGLE_ANALYTICS_HOSTS : null, ids.metaPixelId ? META_PIXEL_HOSTS : null]) {
        if (!hosts) continue;
        script.push(...hosts.script);
        connect.push(...hosts.connect);
        img.push(...hosts.img);
      }
    }
  }
  const uniq = (list: string[]) => [...new Set(list)].join(' ');
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    script.length ? `script-src ${uniq(script)}` : null,
    connect.length ? `connect-src ${uniq(connect)}` : null,
    img.length ? `img-src ${uniq(img)}` : null,
    'frame-ancestors *',
    "base-uri 'none'",
    "form-action 'none'",
  ]
    .filter(Boolean)
    .join('; ');
}
