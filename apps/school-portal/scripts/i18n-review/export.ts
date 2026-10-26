/**
 * Exports every School Portal string for native-speaker review (the
 * "Translation Review" page). Each distinct English text is one item, checked
 * once per language however many screens use it. Run from apps/school-portal:
 *
 *   npx tsx scripts/i18n-review/export.ts <out-dir>
 *
 * Writes <out-dir>/data/items.json (English, where each text is used, notes)
 * and <out-dir>/data/<locale>.json (that language's wording and automatic checks).
 */
import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages as english } from '../../src/i18n/messages/en-GB';
import { LOCALE_LOADERS, directionFor } from '../../src/i18n/locales';
import { SERVER_MESSAGES, SERVER_PATTERNS } from '../../src/i18n/server/en';
import { SERVER_MESSAGE_LOADERS } from '../../src/i18n/server/translate';

type Text = string | Record<string, string>;
type Tree = { [k: string]: Text | Tree };

const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'العربية (Arabic)',
  de: 'Deutsch (German)',
  es: 'Español (Spanish)',
  fr: 'Français (French)',
  it: 'Italiano (Italian)',
  ja: '日本語 (Japanese)',
  ko: '한국어 (Korean)',
  nl: 'Nederlands (Dutch)',
  pl: 'Polski (Polish)',
  'pt-BR': 'Português do Brasil (Brazilian Portuguese)',
  ru: 'Русский (Russian)',
  th: 'ไทย (Thai)',
  tr: 'Türkçe (Turkish)',
  'zh-CN': '简体中文 (Simplified Chinese)',
};

/** Choices a reviewer should look at first: wording a translator had to pick
 * with no earlier term in the file to follow. */
const NOTES: Array<[RegExp, string]> = [
  [/^grading\.board\.fee\./, 'Promotion fee: a new term. Check the word for "fee" and "waive" reads naturally for a martial-arts school.'],
  [/^grading\.board\.decide\./, 'Promotion fee: a new term. Check the word for "fee".'],
  [/^grading\.tabs\.stylesAndBelts$/, '"Styles & Belts" is a tab name. The product owner writes Belts with a capital B in English; use whatever capitals are natural in your language.'],
  [/^grading\.board\.sort\.(aToZ|zToA)$/, 'Alphabetical sort labels. Use the letters your language sorts by.'],
  [/^(layout\.nav\.grading|grading\.tabs\.aria)$/, 'The short name of the Grading menu item.'],
];

/** Recently added, so never checked by anyone yet. */
const NEW: RegExp[] = [
  /^grading\.tabs\./,
  /^grading\.board\.(sort|panel|selection|fee|decide)\./,
  /^grading\.board\.(viewAria|promoteOneTitle|card\.promoteFromBarAria)$/,
  /^layout\.nav\.grading$/,
  /^timetable\.bookedClasses\./,
  /^timetable\.(waitlisted|booking\.addToWaitlist|booking\.waitlistFailed)$/,
  /^server\.codes\./,
  /^schools\.form\.(checkInOpens|checkInOpensHint|lateCancel|lateCancelHint|lateCancelNoRefund|lateCancelRefundUntilEnd|lateCancelAlwaysRefund)$/,
];

const isText = (v: unknown): v is Text => typeof v === 'string' || (typeof v === 'object' && v !== null && typeof (v as { other?: unknown }).other === 'string');

function leaves(tree: Tree, prefix = '', out: Array<[string, Text]> = []): Array<[string, Text]> {
  for (const [k, v] of Object.entries(tree)) {
    if (isText(v)) out.push([prefix + k, v]);
    else leaves(v as Tree, `${prefix}${k}.`, out);
  }
  return out;
}

function lookup(tree: unknown, key: string): Text | undefined {
  const v = key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);
  return isText(v) ? v : undefined;
}

const flat = (t: Text) => (typeof t === 'string' ? t : Object.values(t).join(' '));
const placeholders = (t: Text) => [...new Set([...flat(t).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const idOf = (source: string, t: Text) => createHash('sha1').update(source + JSON.stringify(t)).digest('hex').slice(0, 12);

interface Item {
  id: string;
  source: 'ui' | 'server';
  en: Text;
  keys: string[];
  placeholders: string[];
  note?: string;
  isNew?: boolean;
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('Usage: export.ts <out-dir>');
  mkdirSync(join(outDir, 'data'), { recursive: true });

  const items = new Map<string, Item>();
  const keyToId = new Map<string, string>();
  for (const [key, en] of leaves(english as unknown as Tree)) {
    const id = idOf('ui', en);
    const item = items.get(id) ?? { id, source: 'ui' as const, en, keys: [], placeholders: placeholders(en) };
    item.keys.push(key);
    const note = NOTES.find(([re]) => re.test(key))?.[1];
    if (note) item.note = note;
    if (NEW.some((re) => re.test(key))) item.isNew = true;
    items.set(id, item);
    keyToId.set(key, id);
  }
  // The API's own error messages, translated one-for-one ({v1} = text the server fills in).
  for (const en of [...SERVER_MESSAGES, ...SERVER_PATTERNS]) {
    const id = idOf('server', en);
    if (!items.has(id)) items.set(id, { id, source: 'server', en, keys: [], placeholders: [...new Set([...en.matchAll(/\{(v\d+)\}/g)].map((m) => m[1]))] });
  }

  const locales = Object.keys(LOCALE_LOADERS).sort();
  writeFileSync(
    join(outDir, 'data', 'items.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      locales: locales.map((code) => ({ code, name: LANGUAGE_NAMES[code] ?? code, dir: directionFor(code) })),
      items: [...items.values()],
    }),
  );

  for (const code of locales) {
    const catalogue = await LOCALE_LOADERS[code]();
    const server = SERVER_MESSAGE_LOADERS[code] ? await SERVER_MESSAGE_LOADERS[code]() : {};
    const out: Record<string, { variants: Array<{ text: Text | null; keys: string[] }>; checks: string[] }> = {};
    for (const item of items.values()) {
      const variants = new Map<string, { text: Text | null; keys: string[] }>();
      if (item.source === 'ui') {
        for (const key of item.keys) {
          const text = lookup(catalogue, key) ?? null;
          const sig = JSON.stringify(text);
          const v = variants.get(sig) ?? { text, keys: [] };
          v.keys.push(key);
          variants.set(sig, v);
        }
      } else {
        const text = server[item.en as string] ?? null;
        variants.set(JSON.stringify(text), { text, keys: [] });
      }
      const list = [...variants.values()];
      const checks = new Set<string>();
      for (const v of list) {
        if (v.text === null) {
          checks.add('missing');
          continue;
        }
        const ph = item.source === 'ui' ? placeholders(v.text) : [...new Set([...flat(v.text).matchAll(/\{(v\d+)\}/g)].map((m) => m[1]))].sort();
        if (JSON.stringify(ph) !== JSON.stringify(item.placeholders)) checks.add('placeholders');
        if (flat(v.text).trim() === flat(item.en).trim() && /[A-Za-z]{4}/.test(flat(item.en))) checks.add('sameAsEnglish');
        if (flat(v.text).length > 1.8 * flat(item.en).length && flat(v.text).length > 24) checks.add('long');
      }
      if (list.length > 1) checks.add('variants');
      out[item.id] = { variants: list, checks: [...checks] };
    }
    writeFileSync(join(outDir, 'data', `${code}.json`), JSON.stringify(out));
  }
  console.log(`${items.size} items (${[...items.values()].filter((i) => i.source === 'ui').length} on screens), ${locales.length} languages → ${outDir}/data`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
