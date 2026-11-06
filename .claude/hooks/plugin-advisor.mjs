#!/usr/bin/env node
// Plugin advisor. Suggests (never runs) the plugin, skill or command that fits
// what is happening, using the rules in .claude/plugin-advisor/rules.json.
//
// Hook mode (default): reads the hook JSON from stdin.
//   PostToolUse (Edit/Write/MultiEdit/NotebookEdit) -> matches the edited file path
//   UserPromptSubmit                                 -> matches the prompt text
//   Each rule fires at most once per session, so it costs a line, not a stream.
// Report mode: `node .claude/hooks/plugin-advisor.mjs --report [base-ref]`
//   prints every suggestion for the files changed against base-ref (default
//   origin/master) plus uncommitted changes. Used by the plugin-advisor agent.
//
// It must never break a session: every failure path exits 0 silently.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.CLAUDE_PROJECT_DIR || join(here, '..', '..');

function loadRules() {
  const raw = JSON.parse(readFileSync(join(projectDir, '.claude/plugin-advisor/rules.json'), 'utf8'));
  const compile = (list) => list.map((r) => ({ ...r, re: new RegExp(r.pattern, r.flags || '') }));
  return { fileRules: compile(raw.fileRules || []), promptRules: compile(raw.promptRules || []) };
}

function toRepoPath(p) {
  if (!p) return '';
  const rel = isAbsolute(p) ? relative(projectDir, p) : p;
  return rel.split('\\').join('/');
}

function report(baseRef) {
  const { fileRules } = loadRules();
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' });
    } catch {
      return '';
    }
  };
  const files = new Set(
    [git(['diff', '--name-only', `${baseRef}...HEAD`]), git(['diff', '--name-only', 'HEAD']), git(['ls-files', '--others', '--exclude-standard'])]
      .join('\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const hits = new Map();
  for (const f of files) {
    for (const r of fileRules) {
      if (r.re.test(f)) {
        if (!hits.has(r.id)) hits.set(r.id, { suggest: r.suggest, files: [] });
        hits.get(r.id).files.push(f);
      }
    }
  }
  console.log(`Changed files vs ${baseRef}: ${files.size}`);
  if (!hits.size) {
    console.log('No plugin suggestions for these changes.');
    return;
  }
  for (const [id, h] of hits) {
    const shown = h.files.slice(0, 5).join(', ') + (h.files.length > 5 ? `, +${h.files.length - 5} more` : '');
    console.log(`\n[${id}] ${h.suggest}\n  files: ${shown}`);
  }
}

function hook() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const { fileRules, promptRules } = loadRules();
  const event = input.hook_event_name;
  let matched = [];
  if (event === 'UserPromptSubmit') {
    const text = String(input.prompt || '');
    matched = promptRules.filter((r) => r.re.test(text));
  } else {
    const ti = input.tool_input || {};
    const path = toRepoPath(ti.file_path || ti.notebook_path || (input.tool_response || {}).filePath);
    if (!path || path.startsWith('..')) return;
    matched = fileRules.filter((r) => r.re.test(path));
  }
  if (!matched.length) return;

  // Once per rule per session.
  const session = String(input.session_id || 'nosession').replace(/[^\w-]/g, '');
  const seenFile = join(tmpdir(), `ultm8-plugin-advisor-${session}.json`);
  let seen = [];
  try {
    if (existsSync(seenFile)) seen = JSON.parse(readFileSync(seenFile, 'utf8'));
  } catch {
    seen = [];
  }
  const fresh = matched.filter((r) => !seen.includes(r.id));
  if (!fresh.length) return;
  try {
    writeFileSync(seenFile, JSON.stringify([...seen, ...fresh.map((r) => r.id)]));
  } catch {
    // dedupe is best-effort
  }

  const lines = fresh.map((r) => `- ${r.suggest}`).join('\n');
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Plugin advisor:\n${lines}`,
      hookSpecificOutput: {
        hookEventName: event === 'UserPromptSubmit' ? 'UserPromptSubmit' : 'PostToolUse',
        additionalContext:
          `ULTM8 plugin advisor (suggestions only, nothing was run). Tell the user in one short line which of these applies and why, ` +
          `and run one only if they agree or it is part of what they asked:\n${lines}`,
      },
    }),
  );
}

try {
  const i = process.argv.indexOf('--report');
  if (i !== -1) report(process.argv[i + 1] || 'origin/master');
  else hook();
} catch {
  // never break the session
}
process.exit(0);
