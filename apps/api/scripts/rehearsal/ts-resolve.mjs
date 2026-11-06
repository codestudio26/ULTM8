// node --import ./ts-resolve.mjs — lets Node (with its built-in type
// stripping) import the apps' TypeScript message files, whose imports leave
// out the ".ts" extension as the bundlers allow.
import { register } from 'node:module';
register(new URL('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (err) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw err;
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      try { return await next(specifier + ext, context); } catch {}
    }
    throw err;
  }
}`)));
