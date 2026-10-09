# Takeover prompt

**How to use this.** Start a new Claude chat (or Claude Code in an empty folder), attach `dojohq-grading-handover.zip`, and paste everything below the line as the first message. Nothing needs filling in. If you already know what you want done first, add one sentence at the very end, for example: "After your report, start on the production data model."

A human developer taking over without Claude can skip this file and read `START-HERE.md`.

---

You are taking over a martial arts grading system from a previous Claude team. The owner is Gus. You have no memory of the earlier work. Everything you need is in the attached package, `dojohq-grading-handover.zip`. Unzip it and work inside the `dojohq-grading-handover` folder.

Your first job is to get up to speed and report back to me. Do not change anything yet.

## What you are looking at

`prototype/index.html` is a single-file clickable prototype of a grading system: rank ladders per style, requirements per rank, a progress board, single and bulk promotion, grading events, history, and a curriculum of lessons linked to skills. It has no backend and saves nothing. It exists to pin down the rules and the screens. It is not the product, and its screen code is not meant to be reused.

It was stress tested, fixed and cleaned up on 7 October 2026. `CHANGES.md` lists what changed from the build published in August. `HANDOVER.md` is the full set of notes. Treat the notes as accurate, but if the code and the notes ever disagree, the code is right and you should tell me.

Where it will be built for real is not decided in these files. The notes explain why it is probably the grading module of a larger product called ULTM8 (NestJS and Prisma). Ask me before assuming that.

## Do this first, in this order

1. Read `START-HERE.md`, then `HANDOVER.md` and `CHANGES.md` from start to finish.
2. Read `prototype/index.html` lines 83–541. That is the data and the rules. Read the comments; the earlier decisions are recorded there and nowhere else.
3. Look at the images in `screenshots/` so you know what each screen looks like.
4. Run both tests and confirm you get the results in section 7 of the notes:
   - `python3 tools/run-harness.py qa/qa-harness.html` — expected: `105303 checks, 0 failed`. Five to eight minutes.
   - `python3 tools/e2e-clicks.py prototype/index.html` — expected: `45 steps, 0 failed`.
   - Both need Python with Playwright (`pip install playwright && playwright install chromium`). If you cannot run a browser, say so plainly and do not claim the tests passed.
5. Then report back to me, briefly:
   - what you understand the system to be, in a few sentences;
   - whether the tests gave the expected results;
   - anything in the notes that you found to be wrong or unclear;
   - which of the open decisions in section 9 you need answered first, with your recommendation for each.

Do not write or change any code before step 5.

## Rules for this work

- **The rules in section 6 of the notes are decisions, not suggestions.** They were worked out with me. Do not change how eligibility, promotion, downgrade, events or the board work because you think another way is better. If you think a rule is wrong, say so and ask.
- **Ask, do not assume.** Section 9 lists what I have decided, one rule still waiting for my confirmation, and fourteen open decisions. Do not invent answers to the open ones, even reasonable ones. When you ask, bring a recommendation and your reasoning, and ask as few questions at a time as you can.
- **Do not confuse the three kinds of gap.** Section 8 separates requirements that are stored but cannot be enforced yet, things that are shown on screen but fake, and things that were never built. A fake notification is not a bug to fix; it is a feature to build once I have decided how it works.
- **"DojoHQ" may not be the real product name.** The notes explain why. Do not rename anything until I confirm.
- **The ULTM8 specification is not in the package.** If the work touches the data model, the API, roles or payments, ask me for it before you design anything. Where it differs from the prototype, list the differences and ask which wins.
- **Keep both tests green.** After any change to the prototype, run `python3 tools/rebuild-harness.py prototype/index.html qa/qa-harness.html qa/qa-harness.html`, then both tests. When you change a rule, change the matching reference rule in the test (`refReq`, `refEligible`, `refPct` in `qa/qa-harness.html`) in the same change, and say so. When you fix a bug, add a check that would have caught it.
- **Know the tests' limits.** They ran in Chromium only, at desktop width. Safari, Firefox, phones, keyboard-only use and screen readers are untested.
- **Do not edit the reference files:** anything in `design/`, `docs/`, `qa/archive/`, and `prototype/original-as-published-2026-08-24.html`.
- **Report plainly.** Say what you did, what you checked, and what you did not check. If something failed, say so.

## If you are working as a team of agents

One sensible split, once the first report is done and I have answered:

- **Rules:** lift lines 316–541 of the prototype (dates, `gradingRequirement`, `computeEligibility`, `applyRankChange`, progress) into a module with no screen code, using the stress test's scenarios as its unit tests. This is the part that carries over to production.
- **Data model:** compare the shapes in section 5 of the notes with the ULTM8 spec and propose the tables.
- **Coverage:** run the click-through in Safari and Firefox, at tablet and phone widths, and with the keyboard only. Report what breaks; do not fix layout without asking.
- **Reviewer:** a separate agent that has not seen the work re-runs both tests and reads each change against section 6.

Give every agent `HANDOVER.md` and `CHANGES.md`. Do not summarise them; a summary will drop the details that matter.
