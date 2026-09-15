# Handoff workflow

Two people work on this repo at different hours, each in their own [GitHub
Codespace](https://github.com/codestudio26/ULTM8/tree/master/.devcontainer)
(not a live pairing session). This file is the whole handoff system — there's
no other mechanism, so actually doing these two steps is what keeps work
continuous between you.

## Before you stop working

```bash
git status                # review what actually changed
git add <specific files>  # stage deliberately — not a blind `git add .`
git commit -m "..."       # even a WIP/in-progress commit is fine
git push
```

Push **even if the work is unfinished.** A committed, pushed "half-done, here's
where I got to" is what lets the other person continue — an uncommitted mess
sitting only on your machine is a dead end for them.

This step is **deliberately manual, not automated.** Auto-committing and
pushing whatever happens to be on screen when you close your laptop could
push broken or half-written code straight to a shared branch with no review —
exactly what this project's own `CLAUDE.md` git-safety rules exist to prevent.
Review before you stage, every time.

## When you start working

Nothing to remember here — it's automatic. Every codespace runs
`git pull --ff-only` on startup (see `.devcontainer/devcontainer.json`), so
you're synced with whatever was last pushed before you write a single line.
Fast-forward-only means this step can never overwrite your own work or create
a surprise merge commit — if a clean fast-forward isn't possible, it silently
does nothing and you carry on, same as if this line weren't here.

## What this does and doesn't give you

- **Does**: near-continuous handoff — a 30-second habit closes the gap
  between sessions to almost nothing, and it works whether or not the other
  person is online.
- **Doesn't**: literal same-instant simultaneous editing. For that, use a
  [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare)
  session inside one shared codespace instead — a different mode, for when
  you're both online together on purpose, not a replacement for the habit
  above.
