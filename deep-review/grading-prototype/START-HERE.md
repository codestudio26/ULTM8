# Grading System — start here

This folder is the complete handover of Gus's martial arts grading system prototype. It was recovered, stress tested, fixed and packaged on 7 October 2026.

## Read in this order

1. **`HANDOVER.md`** — the full notes: what it is, how it works, the rules, how it was tested, what is left, and the decisions still open. About 20 minutes.
2. **`CHANGES.md`** — what was fixed and decided on 7 October, and which changes still need Gus to confirm.
3. **`prototype/index.html`** — open it in a browser and click around. Nothing to install.
4. **`TAKEOVER-PROMPT.md`** — if a Claude team is taking over: attach the zip to a new chat and paste this as the first message. Nothing needs filling in.

## The five things to know before anything else

1. **It is a prototype.** One HTML file, no server, no database. Reloading the page resets everything.
2. **The rules are the valuable part**, not the screen code. They are written out in `HANDOVER.md` section 6 and live in lines 316–541 of the prototype.
3. **It has been stress tested and no known bugs remain in what is built.** 105,303 checks pass. Some features are only mocked on screen (notifications, fee, permissions, video) and two requirements (weekly cap, class scope) cannot be enforced without attendance data. `HANDOVER.md` section 8.
4. **Some decisions are made and some are not.** Seven rules were decided by Gus on 7 October, one is waiting for his confirmation, and fourteen are open. `HANDOVER.md` section 9.
5. **Three things are missing from this folder:** the ULTM8 technical specification, the Figma file, and the original conversations. Ask Gus for the first two.

## Test results on 7 October 2026

| Test | Result |
|---|---|
| Stress test (`qa/qa-harness.html`), 13 suites | 105,303 checks, 0 failed |
| Same test under 9 other dates and time zones (clock-change days, a leap day, midnight) | 0 failed |
| 9 more random runs with other seeds, 3,000 actions each | 0 failed |
| Real mouse and keyboard click-through (`tools/e2e-clicks.py`) | 45 steps, 0 failed |
| Same stress test against the build published in August | 2,099 failed |
| 16 faults put into the fixed build on purpose, one at a time | all 16 detected |

Chromium only, desktop width only. Safari, Firefox, phones and keyboard-only use were not tested.

The stress test and the click-through were both run again on the final file after the last tidy-up (comments and unused code only).

To repeat them: `python3 tools/run-harness.py qa/qa-harness.html` and `python3 tools/e2e-clicks.py prototype/index.html` (both need Python with Playwright), or open `qa/qa-harness.html` in a browser and press Run.

## Folder map

```
START-HERE.md            this file
HANDOVER.md              full notes
CHANGES.md               what was fixed and decided on 7 October
TAKEOVER-PROMPT.md       first message for the next Claude team
prototype/               the prototype (fixed) and the build as published in August
qa/                      the stress test, plus the August harness in archive/
tools/                   run-harness.py, e2e-clicks.py, rebuild-harness.py
design/                  the original design canvas and its five screens
docs/                    video hosting memo, ULTM8 spec tracker
screenshots/             one image per screen, from the fixed build
MANIFEST.txt             every file with its size and checksum
```
