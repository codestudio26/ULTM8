import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

/**
 * Backlog 3.17: decision and spec numbers ("(Decision 128)", "(Spec §8.2)") are
 * for us, not for the people reading an error or a grading history note. Keep
 * them in a code comment beside the text instead. Log lines may still carry them.
 */

const REFERENCE = /\((?:Decisions?|Spec)\b[^)]*\)|§/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

function isText(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateLiteralLikeNode {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

/** Text inside exception arguments or a `systemNote` value that names a decision or spec section. */
function referencesInVisibleText(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(join(__dirname, '..'))) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const collect = (node: ts.Node) => {
      if (isText(node) && REFERENCE.test(node.text)) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
        found.push(`${file.slice(file.indexOf('src'))}:${line + 1}  ${node.text}`);
      }
      ts.forEachChild(node, collect);
    };
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node) && /Exception$/.test(node.expression.getText(src))) {
        node.arguments?.forEach(collect);
      } else if (ts.isPropertyAssignment(node) && node.name.getText(src) === 'systemNote') {
        collect(node.initializer);
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return found;
}

describe('Text people see carries no decision or spec numbers', () => {
  it('exception messages and grading history notes', () => {
    expect(referencesInVisibleText()).toEqual([]);
  });
});
