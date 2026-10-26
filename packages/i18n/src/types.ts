/** A message is either one string or one string per plural category, picked
 * with `Intl.PluralRules` for the `count` variable (Arabic has six categories,
 * English two, so a plain "singular/plural" pair can't cover every locale). */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralMessage;

export interface MessageTree {
  [key: string]: Message | MessageTree;
}

/** A locale file may leave any key out; the English text is used for it. */
export type PartialMessages<T> = {
  [K in keyof T]?: T[K] extends string ? string : T[K] extends PluralMessage ? PluralMessage : PartialMessages<T[K]>;
};

/** Every dotted key in the English catalogue, e.g. `'notifications.title'`. */
export type MessageKey<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Message
    ? `${Prefix}${K}`
    : MessageKey<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageVars = Record<string, string | number>;
