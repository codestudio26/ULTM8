/**
 * Decision 319 item 4: the schedule embed's page, for an <iframe> on the
 * School's own website. Plain HTML and inline CSS, no script, no cookies,
 * nothing from another site; every text from the School is escaped. In the
 * 15 languages of the apps (`?lang=`), English when none or another is asked.
 */

export const EMBED_LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'th', 'tr', 'zh-CN'] as const;
export type EmbedLocale = (typeof EMBED_LOCALES)[number];

export interface EmbedTexts {
  title: string;
  empty: string;
  cancelled: string;
  timesIn: string;
  unavailable: string;
}

export const EMBED_TEXTS: Record<EmbedLocale, EmbedTexts> = {
  en: { title: 'Class schedule', empty: 'No classes in the next four weeks.', cancelled: 'Cancelled', timesIn: 'Times are in {tz}.', unavailable: 'This schedule is not available.' },
  ar: { title: 'جدول الحصص', empty: 'لا توجد حصص في الأسابيع الأربعة القادمة.', cancelled: 'ملغاة', timesIn: 'الأوقات بتوقيت {tz}.', unavailable: 'هذا الجدول غير متاح.' },
  de: { title: 'Kursplan', empty: 'Keine Kurse in den nächsten vier Wochen.', cancelled: 'Abgesagt', timesIn: 'Zeiten in {tz}.', unavailable: 'Dieser Kursplan ist nicht verfügbar.' },
  es: { title: 'Horario de clases', empty: 'No hay clases en las próximas cuatro semanas.', cancelled: 'Cancelada', timesIn: 'Horas en {tz}.', unavailable: 'Este horario no está disponible.' },
  fr: { title: 'Planning des cours', empty: 'Aucun cours dans les quatre prochaines semaines.', cancelled: 'Annulé', timesIn: 'Heures en {tz}.', unavailable: "Ce planning n'est pas disponible." },
  it: { title: 'Orario dei corsi', empty: 'Nessun corso nelle prossime quattro settimane.', cancelled: 'Annullato', timesIn: 'Orari in {tz}.', unavailable: 'Questo orario non è disponibile.' },
  ja: { title: 'クラススケジュール', empty: '今後4週間のクラスはありません。', cancelled: '中止', timesIn: '時刻は {tz} です。', unavailable: 'このスケジュールは利用できません。' },
  ko: { title: '수업 시간표', empty: '앞으로 4주 동안 수업이 없습니다.', cancelled: '취소됨', timesIn: '시간은 {tz} 기준입니다.', unavailable: '이 시간표를 볼 수 없습니다.' },
  nl: { title: 'Lesrooster', empty: 'Geen lessen in de komende vier weken.', cancelled: 'Geannuleerd', timesIn: 'Tijden in {tz}.', unavailable: 'Dit rooster is niet beschikbaar.' },
  pl: { title: 'Plan zajęć', empty: 'Brak zajęć w ciągu najbliższych czterech tygodni.', cancelled: 'Odwołane', timesIn: 'Godziny według strefy {tz}.', unavailable: 'Ten plan nie jest dostępny.' },
  'pt-BR': { title: 'Horário das aulas', empty: 'Nenhuma aula nas próximas quatro semanas.', cancelled: 'Cancelada', timesIn: 'Horários em {tz}.', unavailable: 'Este horário não está disponível.' },
  ru: { title: 'Расписание занятий', empty: 'В ближайшие четыре недели занятий нет.', cancelled: 'Отменено', timesIn: 'Время указано по {tz}.', unavailable: 'Это расписание недоступно.' },
  th: { title: 'ตารางคลาส', empty: 'ไม่มีคลาสในสี่สัปดาห์ข้างหน้า', cancelled: 'ยกเลิก', timesIn: 'เวลาตามเขต {tz}', unavailable: 'ตารางนี้ไม่พร้อมใช้งาน' },
  tr: { title: 'Ders programı', empty: 'Önümüzdeki dört haftada ders yok.', cancelled: 'İptal edildi', timesIn: 'Saatler {tz} saatine göredir.', unavailable: 'Bu program kullanılamıyor.' },
  'zh-CN': { title: '课程表', empty: '未来四周没有课程。', cancelled: '已取消', timesIn: '时间为 {tz}。', unavailable: '此课程表不可用。' },
};

export function embedLocale(lang: string | undefined): EmbedLocale {
  const found = EMBED_LOCALES.find((l) => l.toLowerCase() === (lang ?? '').toLowerCase());
  return found ?? 'en';
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface EmbedClass {
  title: string;
  startDate: Date;
  endDate: Date;
  cancelled: boolean;
  branchName: string | null;
  branchTimezone: string | null;
}

function validZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

const STYLE = `body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328;background:#fff}
main{padding:12px 16px;max-width:760px}
h1{font-size:18px;margin:0 0 4px}
h2{font-size:14px;margin:16px 0 4px;padding-bottom:4px;border-bottom:1px solid #d0d7de}
ul{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f0f2f4}
.time{min-width:110px;font-variant-numeric:tabular-nums;color:#57606a}
.where{color:#57606a}
.cancelled .what{text-decoration:line-through;color:#57606a}
.badge{font-size:12px;color:#9a3412}
.note{color:#57606a;font-size:12px;margin:4px 0 0}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}h2{border-color:#30363d}li{border-color:#21262d}.time,.where,.note,.cancelled .what{color:#8b949e}}`;

function page(locale: EmbedLocale, title: string, body: string): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** The page for an unknown, turned-off or closed School's link. */
export function unavailablePage(locale: EmbedLocale): string {
  const t = EMBED_TEXTS[locale];
  return page(locale, t.unavailable, `<p>${escapeHtml(t.unavailable)}</p>`);
}

/** The School's classes grouped by day, each on its Branch's clock (else the
 * School's). */
export function schedulePage(locale: EmbedLocale, school: { schoolName: string; timezone: string | null }, classes: EmbedClass[]): string {
  const t = EMBED_TEXTS[locale];
  const schoolZone = validZone(school.timezone) ?? 'UTC';
  const groups = new Map<string, { label: string; items: string[] }>();
  const zones = new Set<string>();
  for (const c of classes) {
    const zone = validZone(c.branchTimezone) ?? schoolZone;
    zones.add(zone);
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(c.startDate);
    const label = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' }).format(c.startDate);
    const time = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit' });
    const when = `${time.format(c.startDate)}–${time.format(c.endDate)}`;
    const item =
      `<li class="${c.cancelled ? 'cancelled' : ''}"><span class="time">${escapeHtml(when)}</span><span><span class="what">${escapeHtml(c.title)}</span>` +
      (c.branchName ? ` <span class="where">· ${escapeHtml(c.branchName)}</span>` : '') +
      (c.cancelled ? ` <span class="badge">${escapeHtml(t.cancelled)}</span>` : '') +
      `</span></li>`;
    const group = groups.get(dayKey) ?? { label, items: [] };
    group.items.push(item);
    groups.set(dayKey, group);
  }
  const days = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, g]) => `<section><h2>${escapeHtml(g.label)}</h2><ul>${g.items.join('')}</ul></section>`)
    .join('');
  const body =
    `<h1>${escapeHtml(school.schoolName)}</h1><p class="note">${escapeHtml(t.title)}</p>` +
    (classes.length === 0 ? `<p>${escapeHtml(t.empty)}</p>` : days) +
    (zones.size > 0 ? `<p class="note">${escapeHtml(t.timesIn.replace('{tz}', [...zones].join(', ')))}</p>` : '');
  return page(locale, `${school.schoolName} · ${t.title}`, body);
}
