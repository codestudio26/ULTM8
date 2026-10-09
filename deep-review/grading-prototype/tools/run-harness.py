#!/usr/bin/env python3
"""Run the stress test without opening a browser window.

    pip install playwright && playwright install chromium
    python3 tools/run-harness.py qa/qa-harness.html            # summary
    python3 tools/run-harness.py qa/qa-harness.html --json     # full result as JSON
    python3 tools/run-harness.py qa/qa-harness.html --seed 7 --steps 10000
    python3 tools/run-harness.py qa/qa-harness.html --tz Europe/London --now 2026-10-25T00:30:00+01:00

--tz and --now pretend the computer is in another time zone at another moment,
to check that day counting holds on clock-change days, leap days and at midnight.

Exit code is 0 when every check passes, 1 otherwise.
"""
import json, os, sys
from playwright.sync_api import sync_playwright

def main(argv):
    if len(argv) < 2: sys.exit(__doc__)
    path = os.path.abspath(argv[1])
    as_json = '--json' in argv
    seed = argv[argv.index('--seed') + 1] if '--seed' in argv else None
    steps = argv[argv.index('--steps') + 1] if '--steps' in argv else None
    with sync_playwright() as p:
        browser = p.chromium.launch()
        tz = argv[argv.index('--tz') + 1] if '--tz' in argv else None
        now = argv[argv.index('--now') + 1] if '--now' in argv else None
        context = browser.new_context(viewport={'width': 1500, 'height': 1000}, **({'timezone_id': tz} if tz else {}))
        page = context.new_page()
        if now: page.clock.set_fixed_time(now)
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        # the prototype asks Google Fonts for two fonts; skip that so the run works offline
        page.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        page.goto('file://' + path)
        page.wait_for_function("()=>!document.getElementById('runBtn').disabled", timeout=60000)
        if seed: page.fill('#seedInput', seed)
        if steps: page.fill('#stepsInput', steps)
        page.click('#runBtn')
        page.wait_for_function("()=>document.getElementById('statusLine').textContent.startsWith('Done')", timeout=1800000)
        res = page.evaluate("()=>window.harnessResult()")
        res['today'] = page.evaluate("()=>W.formatToday ? W.formatToday() : String(new Date())") + ((' in ' + tz) if tz else '')
        browser.close()
    if as_json:
        print(json.dumps(res, indent=1, ensure_ascii=False))
    else:
        print(res['status'] + '  (today for the app: ' + res['today'] + ')')
        for s in res['suites']:
            print('  %-66s %6d checks  %4d failed  %6d ms' % (s['name'], s['tested'], s['fail'], s['ms']))
        for n in res['notes']: print('  note:', n['text'])
        for f in res['failures'][:60]:
            print('  FAIL [%s] %s -- %s' % (f['suite'], f['label'], f['detail'][:300]))
        if len(res['failures']) > 60: print('  ... and %d more failures' % (len(res['failures']) - 60))
        if errors: print('  harness page errors:', errors[:5])
    return 1 if (res['totals']['fail'] or errors) else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
