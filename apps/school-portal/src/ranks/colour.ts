/** Colour helpers for the belt editor's colour rows (backlog 3.18). */

/** The preset circles: the colours of the built-in belt templates. */
export const PRESET_COLOURS = ['#FFFFFF', '#9CA3AF', '#F0C419', '#E8792B', '#3FA66B', '#3B5FCB', '#6B3FA0', '#7A4A22', '#17181A', '#C23B3B'];

/** At most this many saved colours per School (the API's limit). */
export const MAX_SAVED_COLOURS = 24;

export const isColourCode = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v.trim());

/** "#2a9d8f" → "#2A9D8F"; anything else unchanged. */
export const normalColour = (v: string) => (isColourCode(v) ? v.trim().toUpperCase() : v.trim());

export const sameColour = (a: string, b: string) => normalColour(a) === normalColour(b);

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(normalColour(hex).slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hsvToHex(hsv: Hsv): string {
  return `#${hsvToRgb(hsv)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}
