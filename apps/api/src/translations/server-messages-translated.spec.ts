import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { SERVER_MESSAGE_LOADERS, createServerTextTranslator } from '@ultm8/i18n';

/**
 * Decisions 273/323: every message this API can put in an error response is
 * translated into each School Portal / student app language, so a non-English
 * screen shows the real reason instead of the generic one for its HTTP status.
 * A new or reworded exception message must be added to
 * `packages/i18n/src/server/en.ts` and every locale file beside it.
 *
 * Messages sent with a `code` are left out: the apps show their own wording for
 * those codes. Messages built from variables (not a literal) can't be read here.
 */

const GENERIC = '\u0000generic';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Each literal exception message, with `${…}` parts filled with a sample value. */
function exceptionMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(join(__dirname, '..'))) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node) && /Exception$/.test(node.expression.getText(src)) && node.arguments?.length) {
        let arg: ts.Expression = node.arguments[0];
        let coded = false;
        if (ts.isObjectLiteralExpression(arg)) {
          const prop = (name: string) => arg && ts.isObjectLiteralExpression(arg) ? arg.properties.find((p) => p.name?.getText(src) === name) : undefined;
          coded = prop('code') !== undefined;
          const message = prop('message');
          arg = message && ts.isPropertyAssignment(message) ? message.initializer : arg;
        }
        let text: string | null = null;
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) text = arg.text;
        else if (ts.isTemplateExpression(arg)) text = arg.head.text + arg.templateSpans.map((s) => '2' + s.literal.text).join('');
        if (text && !coded) {
          const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
          found.set(text, `${file.slice(file.indexOf('src'))}:${line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return found;
}

describe('API error messages are translated', () => {
  const messages = exceptionMessages();

  it('finds the API exception messages', () => {
    expect(messages.size).toBeGreaterThan(500);
  });

  for (const locale of Object.keys(SERVER_MESSAGE_LOADERS)) {
    it(`${locale} translates every one`, async () => {
      const t = (key: string) => (key.startsWith('server.generic.') ? GENERIC : key);
      const translator = createServerTextTranslator(t, locale, SERVER_MESSAGE_LOADERS[locale]);
      const untranslated: string[] = [];
      for (const [text, where] of messages) {
        if ((await translator.error(400, '', text)) === GENERIC) untranslated.push(`${where}  ${text}`);
      }
      expect(untranslated).toEqual([]);
    });
  }
});
