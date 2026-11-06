/**
 * The three IBJJF ladder templates (Decisions 131, 182), ported from Gus's
 * prototype `buildIbjjfLadder` (deep-review/grading-prototype/prototype/
 * index.html) with its numbers unchanged. The prototype's ladder is one flat
 * list of rungs; here each belt holds its own rungs, in the same order:
 * "Grey/White Belt" with 0–4 stripes is one belt of five rungs, the black
 * belt's degrees one belt of seven.
 *
 * A rung's numbers are what it takes to be promoted INTO it (classes, minimum
 * days, weekly cap, which class types count), as in the prototype and the
 * grading engine; a time-only rung holds the days to stay on it.
 */

import { ENGLISH_TEMPLATE_NAMES, IbjjfBeltName, TemplateNames } from './ibjjf-names';

export type TemplateId = 'ibjjf' | 'ibjjf_kids_red' | 'ibjjf_kids_yellow';

export const TEMPLATES: Array<{ id: TemplateId; name: string; description: string }> = [
  { id: 'ibjjf', name: 'IBJJF Adult & Kid (White Stripes)', description: 'Kids belts with white stripes, adult belts, black belt degrees. 90 grades (each belt and each stripe).' },
  { id: 'ibjjf_kids_red', name: 'IBJJF Adult & Kid (White & Red Stripes)', description: 'As the White Stripes ladder, plus red stripes on the kids belts. 139 grades (each belt and each stripe).' },
  { id: 'ibjjf_kids_yellow', name: 'IBJJF Adult & Kid (Yellow Stripes)', description: 'As the White & Red Stripes ladder, plus yellow stripes on the kids belts. 175 grades (each belt and each stripe).' },
];

const VARIANTS: Record<TemplateId, { red?: boolean; yellow?: boolean }> = {
  ibjjf: {},
  ibjjf_kids_red: { red: true },
  ibjjf_kids_yellow: { red: true, yellow: true },
};

export const IBJJF_CLASS_TYPES = ['Kids Fundamentals', 'Kids Sparring', 'Adult Fundamentals', 'Adult Sparring', 'Competition Team'];

export interface TemplateRung {
  name: string;
  segments: Array<{ count: number; colour: string }>;
  timeOnly: boolean;
  classesRequired: number | null;
  minimumDaysInRank: number;
  weeklyClassCountCap: number | null;
  eligibleClassTypes: string[];
}

export interface TemplateBelt {
  name: string;
  primaryColour: string;
  secondaryColour: string | null;
  tagColour: string | null;
  coralAccent: string | null;
  rungs: TemplateRung[];
}

const WHITE = '#FFFFFF';
const RED = '#C23B3B'; // the prototype's IBJJF_BLACK_TAG_COLOR
const YELLOW = '#F0C419';
const BLACK = '#17181A';
const SILVER = '#B8BCC2';
const GOLD = '#D9A441';

const K = ['Kids Fundamentals'];
const KS = ['Kids Fundamentals', 'Kids Sparring'];
const A = ['Adult Fundamentals'];
const AS = ['Adult Fundamentals', 'Adult Sparring'];
const COMP = ['Adult Sparring', 'Competition Team'];

// [name, colour, secondary colour, total classes, total days, weekly cap, class types]
type BeltRow = [IbjjfBeltName, string, string | null, number, number, number, string[]];

const KIDS: BeltRow[] = [
  ['White Belt', '#FFFFFF', null, 40, 180, 3, K],
  ['Grey/White Belt', '#9CA3AF', '#FFFFFF', 40, 180, 3, K],
  ['Grey Belt', '#9CA3AF', null, 90, 365, 3, K],
  ['Grey/Black Belt', '#9CA3AF', '#17181A', 90, 365, 3, KS],
  ['Yellow/White Belt', '#F0C419', '#FFFFFF', 90, 365, 3, KS],
  ['Yellow Belt', '#F0C419', null, 90, 365, 3, KS],
  ['Yellow/Black Belt', '#F0C419', '#17181A', 90, 365, 3, KS],
  ['Orange/White Belt', '#E8792B', '#FFFFFF', 90, 365, 3, KS],
  ['Orange Belt', '#E8792B', null, 90, 365, 3, KS],
  ['Orange/Black Belt', '#E8792B', '#17181A', 90, 365, 3, KS],
  ['Green/White Belt', '#3FA66B', '#FFFFFF', 90, 365, 3, KS],
  ['Green Belt', '#3FA66B', null, 90, 365, 3, KS],
  ['Green/Black Belt', '#3FA66B', '#17181A', 90, 365, 4, KS],
];

const ADULT: BeltRow[] = [
  ['Blue Belt', '#3B5FCB', null, 200, 730, 4, A],
  ['Purple Belt', '#6B3FA0', null, 160, 548, 4, AS],
  ['Brown Belt', '#7A4A22', null, 130, 365, 4, AS],
];

function rung(belt: BeltRow, name: string, segments: TemplateRung['segments']): TemplateRung {
  return {
    name,
    segments,
    timeOnly: false,
    // The belt's totals spread over its five stripes, as in the prototype.
    classesRequired: Math.round(belt[3] / 5),
    minimumDaysInRank: Math.round(belt[4] / 5),
    weeklyClassCountCap: belt[5],
    eligibleClassTypes: [...belt[6]],
  };
}

function whiteRungs(belt: BeltRow, names: TemplateNames): TemplateRung[] {
  const rows: TemplateRung[] = [];
  const beltName = names.belts[belt[0]];
  for (let n = 0; n <= 4; n++) {
    rows.push(rung(belt, n === 0 ? beltName : `${beltName} · ${names.stripes(n)}`, n > 0 ? [{ count: n, colour: WHITE }] : []));
  }
  return rows;
}

function redRungs(belt: BeltRow, maxRed: number, names: TemplateNames): TemplateRung[] {
  const beltName = names.belts[belt[0]];
  const rows: TemplateRung[] = [];
  for (let n = 1; n <= maxRed; n++) {
    const segments = [{ count: n, colour: RED }];
    if (4 - n > 0) segments.push({ count: 4 - n, colour: WHITE });
    rows.push(rung(belt, maxRed === 1 ? `${beltName} · ${names.redStripe}` : `${beltName} · ${names.redStripes(n)}`, segments));
  }
  return rows;
}

function yellowRungs(belt: BeltRow, names: TemplateNames): TemplateRung[] {
  const rows: TemplateRung[] = [];
  const beltName = names.belts[belt[0]];
  for (let n = 1; n <= 3; n++) {
    rows.push(rung(belt, `${beltName} · ${names.yellowStripes(n)}`, [{ count: n, colour: YELLOW }, { count: 4 - n, colour: RED }]));
  }
  return rows;
}

function timeRung(name: string, segments: TemplateRung['segments'], days: number): TemplateRung {
  return { name, segments, timeOnly: true, classesRequired: null, minimumDaysInRank: days, weeklyClassCountCap: null, eligibleClassTypes: [...COMP] };
}

function belt(row: BeltRow, rungs: TemplateRung[], names: TemplateNames): TemplateBelt {
  return { name: names.belts[row[0]], primaryColour: row[1], secondaryColour: row[2], tagColour: BLACK, coralAccent: null, rungs };
}

/** The belts of one IBJJF template, lowest first, named in `names`' language
 * (Decision 441 item 8; English by default). */
export function buildIbjjfTemplate(id: TemplateId, names: TemplateNames = ENGLISH_TEMPLATE_NAMES): TemplateBelt[] {
  const opts = VARIANTS[id];
  const belts: TemplateBelt[] = [];
  KIDS.forEach((row, i) => {
    let rungs = whiteRungs(row, names);
    if (opts.red) rungs = rungs.concat(redRungs(row, i === 0 ? 1 : 4, names));
    if (opts.yellow && i > 0) rungs = rungs.concat(yellowRungs(row, names));
    belts.push(belt(row, rungs, names));
  });
  ADULT.forEach((row) => belts.push(belt(row, whiteRungs(row, names), names)));

  const blackDays = [1095, 1095, 1095, 1825, 1825, 1825, 2555];
  const black = names.belts['Black Belt'];
  belts.push({
    name: black,
    primaryColour: BLACK,
    secondaryColour: null,
    tagColour: RED,
    coralAccent: null,
    rungs: blackDays.map((days, n) => timeRung(n === 0 ? black : `${black} · ${names.stripes(n)}`, n > 0 ? [{ count: n, colour: WHITE }] : [], days)),
  });
  const coral: Array<[IbjjfBeltName, string, string | null, number, string]> = [
    ['Red/Black Belt (7th Degree)', '#C23B3B', '#17181A', 2555, SILVER],
    ['Red/White Belt (8th Degree)', '#C23B3B', '#FFFFFF', 3650, SILVER],
    ['Red Belt (9th Degree)', '#C23B3B', null, 0, GOLD],
  ];
  for (const [key, colour, second, days, accent] of coral) {
    const name = names.belts[key];
    belts.push({ name, primaryColour: colour, secondaryColour: second, tagColour: null, coralAccent: accent, rungs: [timeRung(name, [], days)] });
  }
  return belts;
}
