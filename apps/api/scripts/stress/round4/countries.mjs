// Countries for the round 4 world: currency, portal language, time zones,
// phone shape, and names written the way that country writes them (accents,
// apostrophes, hyphens, Arabic, CJK, Thai, Cyrillic).
//   tz          IANA zones; Schools rotate through them, later Branches use the others
//   ph          [country code, national digits]  (E.164, numbers made unique by a counter)
//   priceScale  rough local price level, so plan prices look plausible
export const COUNTRIES = [
  { cc: 'BR', currency: 'BRL', lang: 'pt-BR', tz: ['America/Sao_Paulo', 'America/Manaus', 'America/Noronha'], ph: ['55', 11], priceScale: 2, schoolWord: 'Academia', weekStart: 'SUNDAY',
    first: ['João', 'Maria', 'Conceição', 'Thiago', 'Luíza', 'Ênio', 'Ana Clara'], last: ['Gracie', 'Conceição', 'Araújo', 'dos Santos', 'Magalhães', 'Gonçalves'] },
  { cc: 'GB', currency: 'GBP', lang: 'en-GB', tz: ['Europe/London'], ph: ['44', 10], priceScale: 0.6, schoolWord: 'Academy',
    first: ['Oliver', 'Siobhán', 'Aoife', 'Harry', 'Zoë', 'Niamh'], last: ["O'Brien", 'Smith-Jones', 'MacDonald', "D'Arcy", 'Patel'] },
  { cc: 'US', currency: 'USD', lang: 'en-GB', tz: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Pacific/Honolulu', 'America/Anchorage'], ph: ['1', 10], priceScale: 1, schoolWord: 'Martial Arts', weekStart: 'SUNDAY',
    first: ['Liam', 'Emma', 'José', 'DeShawn', 'Mary-Kate', 'Nguyễn'], last: ['Johnson', 'García', "O'Neil", 'Washington', 'Kim'] },
  { cc: 'AE', currency: 'AED', lang: 'ar', tz: ['Asia/Dubai'], ph: ['971', 9], priceScale: 3, schoolWord: 'أكاديمية',
    first: ['محمد', 'فاطمة', 'عبد الله', 'مريم', 'Omar', 'Layla'], last: ['آل نهيان', 'الحسيني', 'Al-Mansouri', 'بن راشد'] },
  { cc: 'MY', currency: 'MYR', lang: 'en-GB', tz: ['Asia/Kuala_Lumpur'], ph: ['60', 9], priceScale: 3, schoolWord: 'Akademi',
    first: ['Ahmad', 'Siti Nurhaliza', 'Wei Ling', 'Arjun'], last: ['bin Abdullah', 'binti Ismail', 'Tan', 'a/l Muthu'] },
  { cc: 'JP', currency: 'JPY', lang: 'ja', tz: ['Asia/Tokyo'], ph: ['81', 10], priceScale: 120, schoolWord: '道場',
    first: ['翔太', '陽菜', 'さくら', 'Haruto'], last: ['佐藤', '鈴木', '高橋', 'Yamamoto'] },
  { cc: 'KW', currency: 'KWD', lang: 'ar', tz: ['Asia/Kuwait'], ph: ['965', 8], priceScale: 0.3, schoolWord: 'نادي',
    first: ['خالد', 'نورة', 'Yousef'], last: ['الصباح', 'Al-Ghanim'] },
  { cc: 'BH', currency: 'BHD', lang: 'ar', tz: ['Asia/Bahrain'], ph: ['973', 8], priceScale: 0.3, schoolWord: 'نادي',
    first: ['علي', 'زينب'], last: ['آل خليفة', 'Al-Zayani'] },
  { cc: 'IN', currency: 'INR', lang: 'en-GB', tz: ['Asia/Kolkata'], ph: ['91', 10], priceScale: 40, schoolWord: 'Academy',
    first: ['Aarav', 'Ananya', 'Venkataraghavan', 'Priya'], last: ['Sharma', 'Ramachandran', 'Iyer', 'Singh'] },
  { cc: 'NP', currency: 'NPR', lang: 'en-GB', tz: ['Asia/Kathmandu'], ph: ['977', 10], priceScale: 60, schoolWord: 'Dojo',
    first: ['Bishal', 'Sita'], last: ['Gurung', 'Shrestha'] },
  { cc: 'CA', currency: 'CAD', lang: 'en-GB', tz: ['America/St_Johns', 'America/Toronto', 'America/Vancouver'], ph: ['1', 10], priceScale: 1.3, schoolWord: 'Academy', weekStart: 'SUNDAY',
    first: ['Émile', 'Chloé', 'Liam'], last: ['Tremblay', "O'Reilly", 'Côté'] },
  { cc: 'AU', currency: 'AUD', lang: 'en-GB', tz: ['Australia/Sydney', 'Australia/Perth', 'Australia/Adelaide', 'Australia/Lord_Howe'], ph: ['61', 9], priceScale: 1.5, schoolWord: 'Academy',
    first: ['Jack', 'Charlotte', 'Mia'], last: ['Wilson', "O'Connell", 'Nguyen'] },
  { cc: 'NZ', currency: 'NZD', lang: 'en-GB', tz: ['Pacific/Auckland', 'Pacific/Chatham'], ph: ['64', 9], priceScale: 1.6, schoolWord: 'Academy',
    first: ['Aroha', 'Tāne', 'Olivia'], last: ['Ngata', 'Te Whāiti', 'Brown'] },
  { cc: 'KI', currency: 'AUD', lang: 'en-GB', tz: ['Pacific/Kiritimati'], ph: ['686', 8], priceScale: 1.5, schoolWord: 'Club',
    first: ['Teiti', 'Bwebwe'], last: ['Tabwebweiti', 'Kaiea'] },
  { cc: 'MX', currency: 'MXN', lang: 'es', tz: ['America/Mexico_City', 'America/Tijuana', 'America/Cancun'], ph: ['52', 10], priceScale: 18, schoolWord: 'Academia',
    first: ['José María', 'Guadalupe', 'Ximena'], last: ['Hernández', 'Núñez', 'de la Peña'] },
  { cc: 'ES', currency: 'EUR', lang: 'es', tz: ['Europe/Madrid', 'Atlantic/Canary'], ph: ['34', 9], priceScale: 0.8, schoolWord: 'Academia',
    first: ['Íñigo', 'Begoña', 'Nuria'], last: ['Muñoz', 'Ibáñez', 'García-Lorca'] },
  { cc: 'PT', currency: 'EUR', lang: 'pt-BR', tz: ['Europe/Lisbon', 'Atlantic/Azores'], ph: ['351', 9], priceScale: 0.7, schoolWord: 'Academia',
    first: ['Gonçalo', 'Inês'], last: ['Magalhães', 'Sá Carneiro'] },
  { cc: 'FR', currency: 'EUR', lang: 'fr', tz: ['Europe/Paris'], ph: ['33', 9], priceScale: 0.9, schoolWord: 'Académie',
    first: ['Élodie', 'François', 'Anaïs'], last: ['Lefèvre', "D'Artagnan", 'Bérenger'] },
  { cc: 'DE', currency: 'EUR', lang: 'de', tz: ['Europe/Berlin'], ph: ['49', 10], priceScale: 0.9, schoolWord: 'Kampfsportschule',
    first: ['Jürgen', 'Lea-Sophie', 'Björn'], last: ['Müller-Lüdenscheidt', 'Groß', 'Schäfer'] },
  { cc: 'IT', currency: 'EUR', lang: 'it', tz: ['Europe/Rome'], ph: ['39', 10], priceScale: 0.8, schoolWord: 'Accademia',
    first: ['Niccolò', 'Giulia'], last: ["D'Angelo", 'Russo'] },
  { cc: 'NL', currency: 'EUR', lang: 'nl', tz: ['Europe/Amsterdam'], ph: ['31', 9], priceScale: 0.9, schoolWord: 'Vechtsportschool',
    first: ['Sanne', 'Daan'], last: ['van der Berg', "'t Hart"] },
  { cc: 'PL', currency: 'PLN', lang: 'pl', tz: ['Europe/Warsaw'], ph: ['48', 9], priceScale: 3.5, schoolWord: 'Akademia',
    first: ['Łukasz', 'Agnieszka', 'Małgorzata'], last: ['Wiśniewski', 'Żółkiewska', 'Grzegorzewski'] },
  { cc: 'TR', currency: 'TRY', lang: 'tr', tz: ['Europe/Istanbul'], ph: ['90', 10], priceScale: 30, schoolWord: 'Akademi',
    first: ['Çağrı', 'Şükrü', 'Ayşe'], last: ['Yılmaz', 'Öztürk', 'Güneş'] },
  { cc: 'RU', currency: 'RUB', lang: 'ru', tz: ['Europe/Moscow', 'Asia/Vladivostok', 'Asia/Kamchatka'], ph: ['7', 10], priceScale: 80, schoolWord: 'Клуб',
    first: ['Дмитрий', 'Анастасия', 'Ёлка'], last: ['Иванов', 'Смирнова', 'Кузнецов'] },
  { cc: 'TH', currency: 'THB', lang: 'th', tz: ['Asia/Bangkok'], ph: ['66', 9], priceScale: 30, schoolWord: 'ค่ายมวย',
    first: ['สมชาย', 'สุดารัตน์', 'Somchai'], last: ['ใจดี', 'ศรีสุข', 'Sitthichai'] },
  { cc: 'KR', currency: 'KRW', lang: 'ko', tz: ['Asia/Seoul'], ph: ['82', 10], priceScale: 1200, schoolWord: '도장',
    first: ['민준', '서연', 'Ji-ho'], last: ['김', '이', 'Park'] },
  { cc: 'CN', currency: 'CNY', lang: 'zh-CN', tz: ['Asia/Shanghai', 'Asia/Urumqi'], ph: ['86', 11], priceScale: 6, schoolWord: '武馆',
    first: ['伟', '芳', '欧阳娜娜'], last: ['王', '李', '欧阳'] },
  { cc: 'AR', currency: 'ARS', lang: 'es', tz: ['America/Argentina/Buenos_Aires'], ph: ['54', 10], priceScale: 800, schoolWord: 'Academia',
    first: ['Agustín', 'Martina'], last: ['Fernández', 'Gómez'] },
  { cc: 'CL', currency: 'CLP', lang: 'es', tz: ['America/Santiago', 'Pacific/Easter'], ph: ['56', 9], priceScale: 900, schoolWord: 'Academia',
    first: ['Matías', 'Sofía'], last: ['Muñoz', 'Rojas'] },
  { cc: 'CO', currency: 'COP', lang: 'es', tz: ['America/Bogota'], ph: ['57', 10], priceScale: 4000, schoolWord: 'Academia',
    first: ['Santiago', 'Valentina'], last: ['Rodríguez', 'Martínez'] },
  { cc: 'ZA', currency: 'ZAR', lang: 'en-GB', tz: ['Africa/Johannesburg'], ph: ['27', 9], priceScale: 18, schoolWord: 'Academy',
    first: ['Thabo', 'Naledi', 'Pieter'], last: ['Ndlovu', 'van Wyk', 'Botha'] },
  { cc: 'NG', currency: 'NGN', lang: 'en-GB', tz: ['Africa/Lagos'], ph: ['234', 10], priceScale: 1500, schoolWord: 'Academy',
    first: ['Chukwuemeka', 'Ngozi', 'Oluwaseun'], last: ['Okonkwo', 'Adébáyọ̀', 'Eze'] },
  { cc: 'EG', currency: 'EGP', lang: 'ar', tz: ['Africa/Cairo'], ph: ['20', 10], priceScale: 45, schoolWord: 'أكاديمية',
    first: ['أحمد', 'نور'], last: ['عبد الرحمن', 'El-Sayed'] },
  { cc: 'SA', currency: 'SAR', lang: 'ar', tz: ['Asia/Riyadh'], ph: ['966', 9], priceScale: 3.7, schoolWord: 'أكاديمية',
    first: ['سعود', 'ريم'], last: ['آل سعود', 'Al-Qahtani'] },
  { cc: 'IR', currency: 'USD', lang: 'en-GB', tz: ['Asia/Tehran'], ph: ['98', 10], priceScale: 1, schoolWord: 'Club',
    first: ['Dariush', 'Shirin'], last: ['Tehrani', 'Karimi'] },
  { cc: 'SG', currency: 'SGD', lang: 'en-GB', tz: ['Asia/Singapore'], ph: ['65', 8], priceScale: 1.4, schoolWord: 'Academy',
    first: ['Wei Jie', 'Xin Yi'], last: ['Lim', 'Ng'] },
  { cc: 'PH', currency: 'PHP', lang: 'en-GB', tz: ['Asia/Manila'], ph: ['63', 10], priceScale: 50, schoolWord: 'Academy',
    first: ['Jose Rizal', 'Ma. Teresa'], last: ['dela Cruz', 'Santos'] },
  { cc: 'ID', currency: 'IDR', lang: 'en-GB', tz: ['Asia/Jakarta', 'Asia/Jayapura'], ph: ['62', 10], priceScale: 15000, schoolWord: 'Akademi',
    first: ['Budi', 'Siti'], last: ['Santoso', 'Wijaya'] },
  { cc: 'IE', currency: 'EUR', lang: 'en-GB', tz: ['Europe/Dublin'], ph: ['353', 9], priceScale: 0.9, schoolWord: 'Academy',
    first: ['Saoirse', 'Ciarán', 'Pádraig'], last: ["Ó Súilleabháin", "Mac Giolla Phádraig"] },
  { cc: 'SE', currency: 'SEK', lang: 'en-GB', tz: ['Europe/Stockholm'], ph: ['46', 9], priceScale: 10, schoolWord: 'Kampsportsklubb',
    first: ['Åsa', 'Björn'], last: ['Ångström', 'Öberg'] },
];

const pick = (a, rand) => a[Math.floor(rand() * a.length)];

/** A name as that country writes it. Now and then a very long or one-letter name, or an emoji. */
export function nameFor(c, rand) {
  const r = rand();
  if (r < 0.003) return { first: 'X', last: 'Ü' };
  if (r < 0.006) return { first: 'Maximiliano Alejandro Bartolomeu de Souza', last: 'Albuquerque Cavalcanti Pernambucano de Oliveira Neto' };
  if (r < 0.009) return { first: pick(c.first, rand) + ' 🥋', last: pick(c.last, rand) };
  return { first: pick(c.first, rand), last: pick(c.last, rand) };
}

/** E.164, unique per counter value. */
export function phoneFor(c, k) {
  const [cc, n] = c.ph;
  const national = String(9).padEnd(n - 8, '7') + String(k).padStart(8, '0');
  return '+' + cc + national.slice(-n);
}

export function addressFor(c, rand) {
  return { addressLine1: `${Math.floor(rand() * 900) + 1} ${pick(c.last, rand)} St`, addressCity: 'City', addressPostalCode: String(10000 + Math.floor(rand() * 89999)) };
}
