#!/usr/bin/env python3
"""Drive the prototype the way a person does: real mouse clicks, real typing,
real drag-and-drop. The stress test (qa-harness.html) calls the app's
functions directly; this script proves the buttons on screen are wired to
them.

    pip install playwright && playwright install chromium
    python3 tools/e2e-clicks.py prototype/index.html [folder-for-screenshots]

Exit code is 0 when every step passes.
"""
import os, sys
from playwright.sync_api import sync_playwright

results = []
def check(cond, label, detail=''):
    results.append((bool(cond), label, detail))
    print(('  ok    ' if cond else '  FAIL  ') + label + ((' -- ' + str(detail)) if (detail and not cond) else ''))

def main(path, shots=None):
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_' not in m.text and 'Failed to load resource' not in m.text else None)
        page.route('**/*', lambda r: r.abort() if r.request.url.startswith('http') else r.continue_())
        page.goto('file://' + os.path.abspath(path))
        db = lambda js: page.evaluate('()=>' + js)
        def shot(name):
            if shots: page.screenshot(path=os.path.join(shots, name + '.png'))
        card = lambda name: page.locator('[ondragstart^="App.dragStartCard"]', has_text=name)
        column = lambda label: page.locator('[ondrop^="App.dropOnBand"]', has_text=label)
        seen = lambda text, exact=True: page.get_by_text(text, exact=exact).first.is_visible()

        print('Grading Board')
        page.get_by_role('button', name='Grading Board').click()
        check(page.get_by_role('heading', name='Grading Board').is_visible(), 'the sidebar opens the Grading Board')
        check(card('Mia Alvarez').count() == 1 and column('Getting There').locator('[ondragstart]', has_text='Mia Alvarez').count() == 1, 'Mia starts in "Getting There"')
        search = page.locator('#boardSearchInput')
        search.click(); page.keyboard.type('alex', delay=30)
        check(search.input_value() == 'alex', 'typing four letters in the search box keeps all four', search.input_value())
        check(page.evaluate('()=>document.activeElement.id') == 'boardSearchInput', 'the search box still has the cursor')
        check(page.locator('[ondragstart^="App.dragStartCard"]').count() == 1, 'only Alex is shown')
        page.keyboard.press('Control+A'); page.keyboard.press('Backspace')
        check(page.locator('[ondragstart^="App.dragStartCard"]').count() == 9, 'clearing the search shows all 9 students again')
        shot('06-grading-board')

        print('Student panel and Grade')
        card('Alex Chen').click()
        check(seen('Skills for promotion to Purple Belt', False), 'clicking a card opens the student')
        shot('07-student-detail')
        page.get_by_role('button', name='Learning').click()
        check(seen('Eligible to grade'), 'signing off the last skill shows "Eligible to grade"')
        page.get_by_role('button', name='Grade student').click()
        confirm = page.get_by_role('button', name='Confirm grading to Purple Belt')
        check(confirm.is_enabled(), 'Grade opens on the next rank with Confirm ready')
        shot('08-grade-modal')
        page.locator('#rankPickList button', has_text='Purple Belt · 2 Stripes').click()
        check(page.get_by_role('button', name='Confirm grading to Purple Belt · 2 Stripes').is_enabled(), 'clicking another rank changes the target')
        check(page.locator('#rankPickList button', has_text='White Belt').first.is_disabled(), 'earlier ranks cannot be clicked')
        date = page.locator('#gradeDateInput'); date.fill('31 Feb 2026'); date.press('Tab')
        check(page.get_by_role('button', name='Confirm grading to Purple Belt · 2 Stripes').is_disabled(), 'an impossible date disables Confirm')
        date = page.locator('#gradeDateInput'); date.fill(db('formatToday()')); date.press('Tab')
        page.locator('#gradeClassesInput').fill('4'); page.locator('#gradeClassesInput').press('Tab')
        page.get_by_role('button', name='Confirm grading to Purple Belt · 2 Stripes').click()
        check(page.locator('.toast').inner_text().strip().startswith('Alex Chen graded to Purple Belt · 2 Stripes'), 'the toast confirms the grading', page.locator('.toast').inner_text())
        check(db("DB.students.find(s=>s.id==='alex').rankId") == 'purple-2' and db("DB.students.find(s=>s.id==='alex').classesAttended") == 4, 'Alex is now Purple Belt · 2 Stripes with 4 starting classes')
        check(seen('Skipped 2 ranks in between.'), 'the history notes the skipped ranks')

        print('Downgrade')
        page.get_by_role('button', name='Downgrade', exact=True).click()
        reason = page.locator('#downgradeReason'); reason.click(); page.keyboard.type('Returning after injury', delay=10)
        page.locator('#rankPickList button', has_text='Blue Belt · 4 Stripes').click()
        check(page.locator('#downgradeReason').input_value() == 'Returning after injury', 'the reason survives picking a different rank')
        shot('08b-downgrade-modal')
        page.get_by_role('button', name='Confirm downgrade to Blue Belt · 4 Stripes').click()
        check(db("DB.students.find(s=>s.id==='alex').rankId") == 'blue-4', 'Alex is back at Blue Belt · 4 Stripes')
        check(seen('Reason: Returning after injury') and seen('DOWNGRADE'), 'the downgrade and its reason are on the history')
        page.locator('.modal-backdrop button').first.click()

        print('Drag a card between columns')
        card('Mia Alvarez').drag_to(column('Ready to Grade'))
        check(column('Ready to Grade').locator('[ondragstart]', has_text='Mia Alvarez').count() == 1, 'dragging Mia to "Ready to Grade" moves her card there')
        check(db("DB.students.find(s=>s.id==='mia').history[0].type") == 'adjustment', 'the move is written to her history')
        before = db("JSON.stringify(DB.students.find(s=>s.id==='mia'))")
        card('Mia Alvarez').drag_to(column('Ready to Grade'))
        check(db("JSON.stringify(DB.students.find(s=>s.id==='mia'))") == before, 'dropping her on the same column changes nothing')

        print('Bulk promote')
        for name in ('Noah Kim', 'Priya Nair', 'Sofia Reyes'):
            card(name).locator('.board-check').click()
        check(seen('3 selected'), 'ticking three cards shows "3 selected"')
        page.get_by_role('button', name='Promote selected').click()
        note = page.locator('#bulkNoteInput'); note.click(); page.keyboard.type('Spring Grading Day', delay=10)
        check(page.locator('#bulkNoteInput').input_value() == 'Spring Grading Day', 'the note box keeps everything typed')
        rows = page.locator('.modal [draggable="true"]')
        first, last = rows.nth(0).inner_text().split('\n')[1], rows.nth(2).inner_text().split('\n')[1]
        rows.nth(2).drag_to(rows.nth(0), target_position={'x': 40, 'y': 4})
        check(page.locator('.modal [draggable="true"]').nth(0).inner_text().split('\n')[1] == last, 'dragging the last row to the top changes the calling order', page.locator('.modal [draggable="true"]').nth(0).inner_text())
        shot('09-bulk-promote')
        page.get_by_role('button', name='Promote 3 students').click()
        check(seen('You promoted 3 students.'), 'the batch is confirmed')
        check(db("['noah','priya','sofia'].map(i=>DB.students.find(s=>s.id===i).rankId).join()") == 'yellow-black-3,brown,black-4', 'all three moved up exactly one rank')
        check(page.locator('.modal').get_by_text('Noah Kim').first.is_visible() and page.locator('.modal').get_by_text('Sofia Reyes').first.is_visible(), 'the finished list still shows everyone promoted')
        shot('09b-bulk-promote-done')
        page.get_by_role('button', name='Done').click()

        print('Styles & Ranks')
        page.get_by_role('button', name='Styles & Ranks').click()
        ladder = page.locator('[ondragstart^="App.dragStart("]')
        check(ladder.count() == 90, 'the ladder lists 90 ranks')
        shot('01-styles-and-ranks')
        second = ladder.nth(1).inner_text().split('\n')[0]
        ladder.nth(1).drag_to(ladder.nth(0), target_position={'x': 60, 'y': 4})
        check(page.locator('[ondragstart^="App.dragStart("]').nth(0).inner_text().split('\n')[0] == second, 'dragging the second rank above the first reorders the ladder')
        page.locator('[ondragstart^="App.dragStart("]').nth(1).drag_to(page.locator('[ondragstart^="App.dragStart("]').nth(0), target_position={'x': 60, 'y': 4})
        page.get_by_role('button', name='New Style').click()
        page.get_by_role('button', name='Karate').first.click()
        page.locator('#templateStyleNameInput').fill('Shotokan')
        page.get_by_role('button', name='Use this template').click()
        check(db("DB.styles[DB.styles.length-1].name") == 'Shotokan' and db("DB.styles[DB.styles.length-1].ranks.length") == 8, 'a Karate style is created from the template with 8 ranks')
        page.locator('[ondragstart^="App.dragStart("]', has_text='Black Belt').locator('button').first.click()
        page.get_by_role('button', name='Edit rank').click()
        name = page.locator('#rankNameInput'); name.fill('Black Belt 1st Dan')
        page.get_by_role('button', name='Time in rank only').click()
        check(page.locator('#rankNameInput').input_value() == 'Black Belt 1st Dan', 'the typed rank name survives switching on "Time in rank only"')
        check(seen('Min. Years in rank'), 'the form switches to years')
        shot('02-rank-edit-form')
        page.get_by_role('button', name='Save changes').click()
        check(db("(r=>r.name+'|'+r.timeOnly)(DB.styles[DB.styles.length-1].ranks[7])") == 'Black Belt 1st Dan|true', 'the rank is saved as time-only under its new name')
        trash = page.locator('[ondragstart^="App.dragStart("]', has_text='Black Belt 1st Dan').locator('button[title="Delete rank"]')
        trash.click()
        check(seen('Delete "Black Belt 1st Dan"?'), 'the bin asks before deleting')
        page.get_by_role('button', name='Cancel').click()
        check(db("DB.styles[DB.styles.length-1].ranks.length") == 8, 'Cancel keeps the rank')

        print('Skills and curriculum')
        page.get_by_role('button', name='Skill Library').click()
        shot('03-skill-library')
        page.get_by_role('button', name='Curriculum').click()
        shot('04-curriculum')
        page.get_by_role('button', name='Manage curriculum').click()
        lesson = page.locator('[ondragstart^="App.dragStartLesson"]', has_text='Scissor Sweep')
        zone = page.locator('[ondrop*="\'takedowns\',null"]').last
        lesson.drag_to(zone)
        check(db("DB.curriculum.lessons.find(l=>l.id==='l2').categoryId") == 'takedowns', 'dragging a lesson onto another category moves it there')
        page.get_by_role('button', name='+ Add lesson to Guard Work').click()
        page.locator('#lessonTitleInput').click(); page.keyboard.type('Triangle from Guard', delay=5)
        page.locator('button.chip', has_text='Guard Retention').click()
        check(page.locator('#lessonTitleInput').input_value() == 'Triangle from Guard', 'the lesson name survives ticking a skill')
        shot('05-manage-curriculum')
        page.get_by_role('button', name='Add lesson', exact=True).click()
        check(db("DB.curriculum.lessons.some(l=>l.title==='Triangle from Guard' && l.skillIds.join()==='gr')"), 'the lesson is saved with its skill')

        print('Grading events')
        page.get_by_role('button', name='Grading Board').click()
        page.locator('select').select_option(label='IBJJF Adult & Kid(White Stripes)')
        page.get_by_role('button', name='Grading Events').click()
        shot('10-grading-events')
        page.get_by_role('button', name='Schedule Event').click()
        page.locator('#eventTitleInput').click(); page.keyboard.type('Winter Grading', delay=5)
        page.get_by_role('button', name='Create event').click()
        check(db("DB.events[0].title") == 'Winter Grading' and db("DB.events[0].styleId") == 'bjj', 'the event is created for the selected style')
        page.locator('.card', has_text='Winter Grading').get_by_role('button', name='Run event').click()
        n = db("DB.events[0].participants.length")
        check(n >= 1, 'eligible students are pre-filled (%d)' % n)
        who = db("DB.events[0].participants[0].id"); rank_before = db("DB.students.find(s=>s.id==='%s').rankId" % who)
        page.get_by_role('button', name='Pass', exact=True).first.click()
        if n > 1: page.get_by_role('button', name='Fail', exact=True).nth(1).click()
        shot('11-run-event')
        page.get_by_role('button', name='Complete event — promote 1 pass').click()
        check(db("DB.events[0].status") == 'completed', 'the event is completed')
        check(db("DB.students.find(s=>s.id==='%s').rankId" % who) != rank_before and db("DB.students.find(s=>s.id==='%s').history[0].note" % who) == 'Passed at Winter Grading.', 'the student who passed was promoted, with the event on their history')
        page.locator('.card', has_text='Winter Grading').get_by_role('button', name='View results').click()
        check(seen('PASS') and page.get_by_role('button', name='Pass', exact=True).count() == 0, 'the finished event is read-only')
        shot('11b-event-results')

        print('Settings')
        page.get_by_role('button', name='Settings').click()
        check(page.locator('[onclick^="App.togglePerm"]').count() == 6, 'the permissions table has a column for each of the 2 styles')
        shot('12-settings')

        check(not errors, 'no JavaScript errors during the whole session', errors[:3])
        browser.close()
    failed = [r for r in results if not r[0]]
    print('\n%d steps, %d failed' % (len(results), len(failed)))
    return 1 if failed else 0

if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
