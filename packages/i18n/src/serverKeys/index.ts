import type { PartialMessages } from '../types';
import type { ServerKeys } from './en';

export { server as serverKeys, type ServerKeys } from './en';

/** The `server` catalogue namespace per locale, loaded on demand. */
export const SERVER_KEY_LOADERS: Record<string, () => Promise<PartialMessages<ServerKeys>>> = {
  'pt-BR': () => import('./pt-BR').then((m) => m.server),
  es: () => import('./es').then((m) => m.server),
  ar: () => import('./ar').then((m) => m.server),
  fr: () => import('./fr').then((m) => m.server),
  de: () => import('./de').then((m) => m.server),
  it: () => import('./it').then((m) => m.server),
  nl: () => import('./nl').then((m) => m.server),
  pl: () => import('./pl').then((m) => m.server),
  ru: () => import('./ru').then((m) => m.server),
  tr: () => import('./tr').then((m) => m.server),
  ja: () => import('./ja').then((m) => m.server),
  ko: () => import('./ko').then((m) => m.server),
  'zh-CN': () => import('./zh-CN').then((m) => m.server),
  th: () => import('./th').then((m) => m.server),
};
