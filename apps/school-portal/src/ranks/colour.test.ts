import { describe, expect, it } from '@jest/globals';
import { hsvToHex, wheelHueSat } from './colour';

const R = 84; // the belt editor's wheel: 168 pixels across

describe('Colour wheel point', () => {
  it('is white at the centre', () => {
    expect(hsvToHex({ ...wheelHueSat(0, 0, R), v: 1 })).toBe('#FFFFFF');
  });

  it('is white within one pixel of the centre, as a whole-pixel pointer lands there (Firefox)', () => {
    // A click on the middle of a wheel whose box starts at x.5 arrives up to
    // half a pixel off in each direction; this offset picked #FEFEFF before.
    for (const [dx, dy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.25, -0.43],
      [0.7, 0.7],
      [0, -0.99],
    ]) {
      expect(wheelHueSat(dx, dy, R).s).toBe(0);
      expect(hsvToHex({ ...wheelHueSat(dx, dy, R), v: 1 })).toBe('#FFFFFF');
    }
  });

  it('takes the hue from the direction and the saturation from the distance', () => {
    expect(wheelHueSat(R, 0, R)).toEqual({ h: 0, s: 1 });
    expect(hsvToHex({ ...wheelHueSat(R, 0, R), v: 1 })).toBe('#FF0000');
    const down = wheelHueSat(0, R / 2, R);
    expect(down.h).toBeCloseTo(90);
    expect(down.s).toBeCloseTo(0.5);
    expect(wheelHueSat(1, 0, R).s).toBeCloseTo(1 / R);
  });

  it('is full colour past the edge', () => {
    expect(wheelHueSat(-2 * R, 0, R)).toEqual({ h: 180, s: 1 });
  });
});
