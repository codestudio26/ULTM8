/**
 * Decision 441 item 8: the IBJJF templates' belt and stripe names in the
 * School's language, so a Brazilian School's new style starts with "Faixa
 * Branca" and "1 Grau", not "White Belt" and "1 Stripe". The names are copied
 * into the School's own belts when the style is made; the owner can rename
 * them, and belts made before stay as they are.
 *
 * English is the template's own wording, unchanged. The other languages use
 * the usual words for BJJ belts and stripes in that language.
 */

/** The template's English belt names, which key every language's table. */
export const IBJJF_BELT_NAMES = [
  'White Belt',
  'Grey/White Belt',
  'Grey Belt',
  'Grey/Black Belt',
  'Yellow/White Belt',
  'Yellow Belt',
  'Yellow/Black Belt',
  'Orange/White Belt',
  'Orange Belt',
  'Orange/Black Belt',
  'Green/White Belt',
  'Green Belt',
  'Green/Black Belt',
  'Blue Belt',
  'Purple Belt',
  'Brown Belt',
  'Black Belt',
  'Red/Black Belt (7th Degree)',
  'Red/White Belt (8th Degree)',
  'Red Belt (9th Degree)',
] as const;

export type IbjjfBeltName = (typeof IBJJF_BELT_NAMES)[number];

export interface TemplateNames {
  belts: Record<IbjjfBeltName, string>;
  /** "1 Stripe", "2 Stripes" (white stripes; the black belt's degrees too). */
  stripes: (n: number) => string;
  /** The one red stripe of the kids' white belt. */
  redStripe: string;
  /** "1 Red Stripe", "2 Red Stripes". */
  redStripes: (n: number) => string;
  /** "1 Yellow Stripe", "2 Yellow Stripes". */
  yellowStripes: (n: number) => string;
}

const belts = (names: string[]): Record<IbjjfBeltName, string> =>
  Object.fromEntries(IBJJF_BELT_NAMES.map((key, i) => [key, names[i]])) as Record<IbjjfBeltName, string>;

/** Polish and Russian: one form for 1, another for 2–4, another for 5 and up. */
const slavic = (n: number, one: string, few: string, many: string) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

/** Arabic: one, two, then three to ten. */
const arabic = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);

const plural = (n: number) => (n === 1 ? '' : 's');

export const ENGLISH_TEMPLATE_NAMES: TemplateNames = {
  belts: belts([...IBJJF_BELT_NAMES]),
  stripes: (n) => `${n} Stripe${plural(n)}`,
  redStripe: 'Red Stripe',
  redStripes: (n) => `${n} Red Stripe${plural(n)}`,
  yellowStripes: (n) => `${n} Yellow Stripe${plural(n)}`,
};

const TEMPLATE_NAMES: Record<string, TemplateNames> = {
  'pt-BR': {
    belts: belts([
      'Faixa Branca', 'Faixa Cinza e Branca', 'Faixa Cinza', 'Faixa Cinza e Preta',
      'Faixa Amarela e Branca', 'Faixa Amarela', 'Faixa Amarela e Preta',
      'Faixa Laranja e Branca', 'Faixa Laranja', 'Faixa Laranja e Preta',
      'Faixa Verde e Branca', 'Faixa Verde', 'Faixa Verde e Preta',
      'Faixa Azul', 'Faixa Roxa', 'Faixa Marrom', 'Faixa Preta',
      'Faixa Vermelha e Preta (7º Grau)', 'Faixa Vermelha e Branca (8º Grau)', 'Faixa Vermelha (9º Grau)',
    ]),
    stripes: (n) => `${n} Grau${n === 1 ? '' : 's'}`,
    redStripe: 'Grau Vermelho',
    redStripes: (n) => (n === 1 ? '1 Grau Vermelho' : `${n} Graus Vermelhos`),
    yellowStripes: (n) => (n === 1 ? '1 Grau Amarelo' : `${n} Graus Amarelos`),
  },
  es: {
    belts: belts([
      'Cinturón Blanco', 'Cinturón Gris y Blanco', 'Cinturón Gris', 'Cinturón Gris y Negro',
      'Cinturón Amarillo y Blanco', 'Cinturón Amarillo', 'Cinturón Amarillo y Negro',
      'Cinturón Naranja y Blanco', 'Cinturón Naranja', 'Cinturón Naranja y Negro',
      'Cinturón Verde y Blanco', 'Cinturón Verde', 'Cinturón Verde y Negro',
      'Cinturón Azul', 'Cinturón Morado', 'Cinturón Marrón', 'Cinturón Negro',
      'Cinturón Rojo y Negro (7.º Grado)', 'Cinturón Rojo y Blanco (8.º Grado)', 'Cinturón Rojo (9.º Grado)',
    ]),
    stripes: (n) => `${n} Grado${n === 1 ? '' : 's'}`,
    redStripe: 'Grado Rojo',
    redStripes: (n) => (n === 1 ? '1 Grado Rojo' : `${n} Grados Rojos`),
    yellowStripes: (n) => (n === 1 ? '1 Grado Amarillo' : `${n} Grados Amarillos`),
  },
  fr: {
    belts: belts([
      'Ceinture blanche', 'Ceinture grise et blanche', 'Ceinture grise', 'Ceinture grise et noire',
      'Ceinture jaune et blanche', 'Ceinture jaune', 'Ceinture jaune et noire',
      'Ceinture orange et blanche', 'Ceinture orange', 'Ceinture orange et noire',
      'Ceinture verte et blanche', 'Ceinture verte', 'Ceinture verte et noire',
      'Ceinture bleue', 'Ceinture violette', 'Ceinture marron', 'Ceinture noire',
      'Ceinture rouge et noire (7e degré)', 'Ceinture rouge et blanche (8e degré)', 'Ceinture rouge (9e degré)',
    ]),
    stripes: (n) => `${n} barrette${n === 1 ? '' : 's'}`,
    redStripe: 'Barrette rouge',
    redStripes: (n) => (n === 1 ? '1 barrette rouge' : `${n} barrettes rouges`),
    yellowStripes: (n) => (n === 1 ? '1 barrette jaune' : `${n} barrettes jaunes`),
  },
  it: {
    belts: belts([
      'Cintura bianca', 'Cintura grigia e bianca', 'Cintura grigia', 'Cintura grigia e nera',
      'Cintura gialla e bianca', 'Cintura gialla', 'Cintura gialla e nera',
      'Cintura arancione e bianca', 'Cintura arancione', 'Cintura arancione e nera',
      'Cintura verde e bianca', 'Cintura verde', 'Cintura verde e nera',
      'Cintura blu', 'Cintura viola', 'Cintura marrone', 'Cintura nera',
      'Cintura rossa e nera (7° grado)', 'Cintura rossa e bianca (8° grado)', 'Cintura rossa (9° grado)',
    ]),
    stripes: (n) => (n === 1 ? '1 grado' : `${n} gradi`),
    redStripe: 'Grado rosso',
    redStripes: (n) => (n === 1 ? '1 grado rosso' : `${n} gradi rossi`),
    yellowStripes: (n) => (n === 1 ? '1 grado giallo' : `${n} gradi gialli`),
  },
  de: {
    belts: belts([
      'Weißer Gurt', 'Grau-weißer Gurt', 'Grauer Gurt', 'Grau-schwarzer Gurt',
      'Gelb-weißer Gurt', 'Gelber Gurt', 'Gelb-schwarzer Gurt',
      'Orange-weißer Gurt', 'Oranger Gurt', 'Orange-schwarzer Gurt',
      'Grün-weißer Gurt', 'Grüner Gurt', 'Grün-schwarzer Gurt',
      'Blauer Gurt', 'Lila Gurt', 'Brauner Gurt', 'Schwarzer Gurt',
      'Rot-schwarzer Gurt (7. Grad)', 'Rot-weißer Gurt (8. Grad)', 'Roter Gurt (9. Grad)',
    ]),
    stripes: (n) => `${n} Streifen`,
    redStripe: 'Roter Streifen',
    redStripes: (n) => (n === 1 ? '1 roter Streifen' : `${n} rote Streifen`),
    yellowStripes: (n) => (n === 1 ? '1 gelber Streifen' : `${n} gelbe Streifen`),
  },
  nl: {
    belts: belts([
      'Witte band', 'Grijs-witte band', 'Grijze band', 'Grijs-zwarte band',
      'Geel-witte band', 'Gele band', 'Geel-zwarte band',
      'Oranje-witte band', 'Oranje band', 'Oranje-zwarte band',
      'Groen-witte band', 'Groene band', 'Groen-zwarte band',
      'Blauwe band', 'Paarse band', 'Bruine band', 'Zwarte band',
      'Rood-zwarte band (7e graad)', 'Rood-witte band (8e graad)', 'Rode band (9e graad)',
    ]),
    stripes: (n) => (n === 1 ? '1 streep' : `${n} strepen`),
    redStripe: 'Rode streep',
    redStripes: (n) => (n === 1 ? '1 rode streep' : `${n} rode strepen`),
    yellowStripes: (n) => (n === 1 ? '1 gele streep' : `${n} gele strepen`),
  },
  pl: {
    belts: belts([
      'Biały pas', 'Szaro-biały pas', 'Szary pas', 'Szaro-czarny pas',
      'Żółto-biały pas', 'Żółty pas', 'Żółto-czarny pas',
      'Pomarańczowo-biały pas', 'Pomarańczowy pas', 'Pomarańczowo-czarny pas',
      'Zielono-biały pas', 'Zielony pas', 'Zielono-czarny pas',
      'Niebieski pas', 'Purpurowy pas', 'Brązowy pas', 'Czarny pas',
      'Czerwono-czarny pas (7. stopień)', 'Czerwono-biały pas (8. stopień)', 'Czerwony pas (9. stopień)',
    ]),
    stripes: (n) => slavic(n, 'belka', 'belki', 'belek'),
    redStripe: 'Czerwona belka',
    redStripes: (n) => slavic(n, 'czerwona belka', 'czerwone belki', 'czerwonych belek'),
    yellowStripes: (n) => slavic(n, 'żółta belka', 'żółte belki', 'żółtych belek'),
  },
  ru: {
    belts: belts([
      'Белый пояс', 'Серо-белый пояс', 'Серый пояс', 'Серо-чёрный пояс',
      'Жёлто-белый пояс', 'Жёлтый пояс', 'Жёлто-чёрный пояс',
      'Оранжево-белый пояс', 'Оранжевый пояс', 'Оранжево-чёрный пояс',
      'Зелёно-белый пояс', 'Зелёный пояс', 'Зелёно-чёрный пояс',
      'Синий пояс', 'Фиолетовый пояс', 'Коричневый пояс', 'Чёрный пояс',
      'Красно-чёрный пояс (7-я степень)', 'Красно-белый пояс (8-я степень)', 'Красный пояс (9-я степень)',
    ]),
    stripes: (n) => slavic(n, 'полоска', 'полоски', 'полосок'),
    redStripe: 'Красная полоска',
    redStripes: (n) => slavic(n, 'красная полоска', 'красные полоски', 'красных полосок'),
    yellowStripes: (n) => slavic(n, 'жёлтая полоска', 'жёлтые полоски', 'жёлтых полосок'),
  },
  tr: {
    belts: belts([
      'Beyaz kuşak', 'Gri-beyaz kuşak', 'Gri kuşak', 'Gri-siyah kuşak',
      'Sarı-beyaz kuşak', 'Sarı kuşak', 'Sarı-siyah kuşak',
      'Turuncu-beyaz kuşak', 'Turuncu kuşak', 'Turuncu-siyah kuşak',
      'Yeşil-beyaz kuşak', 'Yeşil kuşak', 'Yeşil-siyah kuşak',
      'Mavi kuşak', 'Mor kuşak', 'Kahverengi kuşak', 'Siyah kuşak',
      'Kırmızı-siyah kuşak (7. derece)', 'Kırmızı-beyaz kuşak (8. derece)', 'Kırmızı kuşak (9. derece)',
    ]),
    stripes: (n) => `${n} şerit`,
    redStripe: 'Kırmızı şerit',
    redStripes: (n) => `${n} kırmızı şerit`,
    yellowStripes: (n) => `${n} sarı şerit`,
  },
  ar: {
    belts: belts([
      'الحزام الأبيض', 'الحزام الرمادي والأبيض', 'الحزام الرمادي', 'الحزام الرمادي والأسود',
      'الحزام الأصفر والأبيض', 'الحزام الأصفر', 'الحزام الأصفر والأسود',
      'الحزام البرتقالي والأبيض', 'الحزام البرتقالي', 'الحزام البرتقالي والأسود',
      'الحزام الأخضر والأبيض', 'الحزام الأخضر', 'الحزام الأخضر والأسود',
      'الحزام الأزرق', 'الحزام البنفسجي', 'الحزام البني', 'الحزام الأسود',
      'الحزام الأحمر والأسود (الدرجة 7)', 'الحزام الأحمر والأبيض (الدرجة 8)', 'الحزام الأحمر (الدرجة 9)',
    ]),
    stripes: (n) => arabic(n, 'شريط واحد', 'شريطان', 'أشرطة'),
    redStripe: 'شريط أحمر',
    redStripes: (n) => arabic(n, 'شريط أحمر واحد', 'شريطان أحمران', 'أشرطة حمراء'),
    yellowStripes: (n) => arabic(n, 'شريط أصفر واحد', 'شريطان أصفران', 'أشرطة صفراء'),
  },
  ja: {
    belts: belts([
      '白帯', '灰白帯', '灰帯', '灰黒帯',
      '黄白帯', '黄帯', '黄黒帯',
      '橙白帯', '橙帯', '橙黒帯',
      '緑白帯', '緑帯', '緑黒帯',
      '青帯', '紫帯', '茶帯', '黒帯',
      '赤黒帯（7段）', '赤白帯（8段）', '赤帯（9段）',
    ]),
    stripes: (n) => `ストライプ${n}本`,
    redStripe: '赤ストライプ',
    redStripes: (n) => `赤ストライプ${n}本`,
    yellowStripes: (n) => `黄ストライプ${n}本`,
  },
  ko: {
    belts: belts([
      '흰색 띠', '회색-흰색 띠', '회색 띠', '회색-검은색 띠',
      '노란색-흰색 띠', '노란색 띠', '노란색-검은색 띠',
      '주황색-흰색 띠', '주황색 띠', '주황색-검은색 띠',
      '초록색-흰색 띠', '초록색 띠', '초록색-검은색 띠',
      '파란색 띠', '보라색 띠', '갈색 띠', '검은색 띠',
      '빨간색-검은색 띠 (7단)', '빨간색-흰색 띠 (8단)', '빨간색 띠 (9단)',
    ]),
    stripes: (n) => `그랄 ${n}개`,
    redStripe: '빨간 그랄',
    redStripes: (n) => `빨간 그랄 ${n}개`,
    yellowStripes: (n) => `노란 그랄 ${n}개`,
  },
  'zh-CN': {
    belts: belts([
      '白带', '灰白带', '灰带', '灰黑带',
      '黄白带', '黄带', '黄黑带',
      '橙白带', '橙带', '橙黑带',
      '绿白带', '绿带', '绿黑带',
      '蓝带', '紫带', '棕带', '黑带',
      '红黑带（七段）', '红白带（八段）', '红带（九段）',
    ]),
    stripes: (n) => `${n} 道杠`,
    redStripe: '红杠',
    redStripes: (n) => `${n} 道红杠`,
    yellowStripes: (n) => `${n} 道黄杠`,
  },
  th: {
    belts: belts([
      'สายขาว', 'สายเทาขาว', 'สายเทา', 'สายเทาดำ',
      'สายเหลืองขาว', 'สายเหลือง', 'สายเหลืองดำ',
      'สายส้มขาว', 'สายส้ม', 'สายส้มดำ',
      'สายเขียวขาว', 'สายเขียว', 'สายเขียวดำ',
      'สายน้ำเงิน', 'สายม่วง', 'สายน้ำตาล', 'สายดำ',
      'สายแดงดำ (ดั้ง 7)', 'สายแดงขาว (ดั้ง 8)', 'สายแดง (ดั้ง 9)',
    ]),
    stripes: (n) => `${n} แถบ`,
    redStripe: 'แถบแดง',
    redStripes: (n) => `แถบแดง ${n} แถบ`,
    yellowStripes: (n) => `แถบเหลือง ${n} แถบ`,
  },
};

/** The names for a School's language (`School.defaultLanguage`, e.g. "pt-BR"):
 * English when it has none, an English one, or one without a table. */
export function templateNamesFor(language: string | null | undefined): TemplateNames {
  const lang = (language ?? '').toLowerCase();
  const key = Object.keys(TEMPLATE_NAMES).find((code) => code.toLowerCase() === lang);
  return key ? TEMPLATE_NAMES[key] : ENGLISH_TEMPLATE_NAMES;
}

/** Every language with its own names (tests). */
export const TEMPLATE_NAME_LANGUAGES = Object.keys(TEMPLATE_NAMES);
