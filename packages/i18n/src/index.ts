/**
 * Shared translation core (Decisions 273, 323), used by the School Portal and
 * the student app. Each app keeps its own screen text; what is shared is how a
 * message is looked up and formatted, which locales exist, and the API's own
 * English text (errors and job-written notifications) translated per locale.
 */
export * from './types';
export * from './core';
export { SERVER_MESSAGE_LOADERS, createServerTextTranslator, type ServerTextTranslator } from './server/translate';
export { SERVER_MESSAGES, SERVER_PATTERNS } from './server/en';
export { SERVER_KEY_LOADERS, serverKeys, type ServerKeys } from './serverKeys';
