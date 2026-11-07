// Round 6: the round 4 scripts pick School bands by index in a 500-School world
// (e.g. 300–340). The scaled world has cast.schools.length Schools; N(300) maps
// an index of the 500-School world onto it.
import { cast } from './common.mjs';
export const N = (i) => Math.round((i * cast.schools.length) / 500);
