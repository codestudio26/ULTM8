import React from 'react';
import { useT, type TranslationKey } from './I18nProvider';
import type { MessageVars } from './types';

/** For a sentence with markup inside it (a bold name, a link): the sentence
 * stays one translatable string, and each `{name}` in `nodes` is swapped for
 * a React element, so a translator can move it anywhere the grammar needs. */
export function Trans({ k, vars, nodes }: { k: TranslationKey; vars?: MessageVars; nodes: Record<string, React.ReactNode> }) {
  const text = useT()(k, vars);
  const parts = text.split(/\{(\w+)\}/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 && part in nodes ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : i % 2 === 1 ? `{${part}}` : part,
      )}
    </>
  );
}
