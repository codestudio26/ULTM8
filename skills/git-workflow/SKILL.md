---
name: git-workflow
description: Governance skill for safe, deliberate git usage on the ULTM8 project — reviewing diffs, focused commits, and never staging blindly.
---

# Git Workflow

## Purpose

This skill governs safe, deliberate use of git across the project.

## When to Use

Load before staging, committing, or otherwise changing git state.

## Core Principles

- Inspect before modifying.
- Review every diff before staging.
- Keep commits focused and meaningful.
- Stage deliberately, never blindly.
- Preserve existing safety checkpoints.

## Rules

- Run `git status`/`git diff` and actually read the output before staging anything.
- Stage specific, reviewed paths rather than staging broadly.
- Write a commit message that describes what changed and why.
- Never discard work you haven't confirmed is safe to lose.
- Verify status again before committing.

## ULTM8 Constraints

This skill covers general git safety only. It does not define ULTM8-specific branching, release, or commit-message conventions — those come from Spec 55, approved architectural decisions, or other explicitly approved project documentation if and when they're established.

## Must NOT

- Must not use `git add .` (or equivalent blanket staging) without first reviewing exactly what it would include.
- Must not discard or overwrite unknown/uncommitted work.
- Must not force-push or rewrite history without explicit approval.
- Must not commit without the user's request.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
