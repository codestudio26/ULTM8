// Which bidi control / Arabic special characters have a glyph in any of the PDF fonts.
const path = require('path');
const fontkit = require(require.resolve('fontkit', { paths: [path.resolve(__dirname, '../../../..')] }));
const m = require(path.resolve(__dirname, '../../../../dist/signed-documents/signed-document-pdf.js'));
const fs = require('fs');
const dir = (n) => path.dirname(require.resolve(n + '/package.json', { paths: [path.resolve(__dirname, '../../../..')] }));
const files = [path.join(dir('@fontsource/noto-sans'), 'files', 'noto-sans-latin-400-normal.woff'), path.join(dir('@fontsource/noto-sans-arabic'), 'files', 'noto-sans-arabic-arabic-400-normal.woff')];
const fonts = files.map((f) => fontkit.create(m.woffToSfnt(fs.readFileSync(f))));
const cps = { RLM: 0x200f, LRM: 0x200e, ALM: 0x061c, RLE: 0x202b, PDF: 0x202c, RLI: 0x2067, PDI: 0x2069, ZWNJ: 0x200c, ZWJ: 0x200d, TATWEEL: 0x0640, ARABIC_COMMA: 0x060c, ARABIC_QM: 0x061f, AR_INDIC_3: 0x0663, EXT_AR_INDIC_3: 0x06f3, DIRHAM_SIGN: 0x20c3, NBSP: 0xa0 };
for (const [k, cp] of Object.entries(cps)) console.log(k.padEnd(14), cp.toString(16), fonts.map((f) => f.hasGlyphForCodePoint(cp)).join(' '));
for (const [k, cp] of Object.entries({ RLM: 0x200f, RLI: 0x2067, PDI: 0x2069, DIRHAM: 0x20c3 })) {
  for (const [i, f] of fonts.entries()) { const r = f.layout('ف' + String.fromCodePoint(cp) + 'ف'); console.log('layout', k, 'font', i, r.glyphs.map((g) => `${g.id}:${g.name}:${g.advanceWidth}`).join(' ')); }
}
