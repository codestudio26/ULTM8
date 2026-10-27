import type { MessageKey, MessageVars } from '@ultm8/i18n';
import type { EnglishMessages } from './messages/en';

export type TranslationKey = MessageKey<EnglishMessages>;
export type TranslateFn = (key: TranslationKey, vars?: MessageVars) => string;
