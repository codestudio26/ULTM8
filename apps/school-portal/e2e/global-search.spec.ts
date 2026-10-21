import { randomUUID } from 'crypto';
import { expect, test, type Page } from '@playwright/test';
import { addBranch, addCoach, addPerson, addStudent, cleanup, db, seedGradingSchool, signIn, type GradingSchool } from './fixtures';

/**
 * Decision 278 — the header's Global Search: one box finding Students,
 * Instructors, Classes, Branches and Franchises by name, grouped by type, each
 * result opening that record's page. Only the types the sidebar offers; never
 * another School's rows.
 */

let s: GradingSchool;
let other: GradingSchool;
let word: string;
const franchiseIds: string[] = [];
const schoolIds: string[] = [];

test.beforeEach(async () => {
  s = await seedGradingSchool();
  other = await seedGradingSchool();
  schoolIds.push(s.schoolId, other.schoolId);
  // A made-up word only this test's rows carry.
  word = `Zeph${randomUUID().slice(0, 6)}`;
});

test.afterAll(async () => {
  // fixtures' cleanup() doesn't know about Instructor profiles or Classes.
  await db.instructor.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await db.class.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await db.roleGrant.deleteMany({ where: { franchiseId: { in: franchiseIds } } });
  await db.franchise.deleteMany({ where: { id: { in: franchiseIds } } });
  await cleanup();
});

const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search', exact: true });
const results = (page: Page) => page.getByRole('listbox', { name: 'Search results' });

test('an owner finds a student by part of their name and opens them', async ({ page }) => {
  const student = await addStudent(s, `${word}ina`, 'Harrow', { rung: 'White 1' });
  await addStudent(s, 'Someone', 'Else', { rung: 'White 1' });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  await searchBox(page).fill(word.slice(0, 7).toLowerCase());
  const option = results(page).getByRole('option', { name: student.name });
  await expect(option).toBeVisible();
  await expect(results(page).getByRole('option', { name: 'Someone Else' })).toHaveCount(0);

  // Keyboard: arrow down to the result, Enter opens it.
  await searchBox(page).press('ArrowDown');
  await expect(option).toHaveAttribute('aria-selected', 'true');
  await searchBox(page).press('Enter');
  await expect(page).toHaveURL(new RegExp(`/students/${student.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: student.name })).toBeVisible();
  await expect(searchBox(page)).toHaveValue('');
});

test('results are grouped by type, and each opens its own page', async ({ page }) => {
  const student = await addStudent(s, word, 'Student', { rung: 'White 1' });
  const coach = await addCoach(s, word, 'Coach');
  const profile = await db.instructor.create({ data: { id: randomUUID(), userId: coach.id, schoolId: s.schoolId } });
  const cls = await db.class.create({
    data: { id: randomUUID(), schoolId: s.schoolId, title: `${word} Kids Class`, activities: ['BJJ'], startDate: new Date(), endDate: new Date(Date.now() + 3_600_000) },
  });
  const branch = await addBranch(s, `${word} Dojo`);
  const franchise = await db.franchise.create({ data: { id: randomUUID(), name: `${word} Group` } });
  franchiseIds.push(franchise.id);
  await db.roleGrant.create({ data: { id: randomUUID(), role: 'FRANCHISE_OWNER', userId: s.ownerId, franchiseId: franchise.id } });

  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');
  await searchBox(page).fill(word);

  const list = results(page);
  for (const [group, name] of [
    ['Students', student.name],
    ['Instructors', coach.name],
    ['Classes', cls.title],
    ['Branches', branch.name],
    ['Franchises', franchise.name],
  ]) {
    await expect(list.getByRole('group', { name: group }).getByRole('option', { name })).toBeVisible();
  }

  await list.getByRole('option', { name: branch.name }).click();
  await expect(page).toHaveURL(new RegExp(`/branches/${branch.id}$`));

  await searchBox(page).fill(word);
  await results(page).getByRole('option', { name: coach.name }).click();
  await expect(page).toHaveURL(new RegExp(`/instructors/${profile.id}$`));
});

test("another School's records never appear", async ({ page }) => {
  const mine = await addStudent(s, word, 'Mine', { rung: 'White 1' });
  await addStudent(other, word, 'Theirs', { rung: 'White 1' });
  await addBranch(other, `${word} Their Dojo`);
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  await searchBox(page).fill(word);
  await expect(results(page).getByRole('option', { name: mine.name })).toBeVisible();
  await expect(results(page).getByRole('option')).toHaveCount(1);
  await expect(page.getByText(`${word} Theirs`)).toHaveCount(0);
  await expect(page.getByText(`${word} Their Dojo`)).toHaveCount(0);
});

test('shows "No results", and Escape or a click outside closes the list', async ({ page }) => {
  await addStudent(s, word, 'Student', { rung: 'White 1' });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  await searchBox(page).fill(`${word}-nobody`);
  await expect(page.getByRole('status').filter({ hasText: `No results for “${word}-nobody”` })).toBeVisible();

  await searchBox(page).fill(word);
  await expect(results(page).getByRole('option')).toHaveCount(1);
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'true');
  await searchBox(page).press('Escape');
  await expect(results(page)).toBeHidden();
  await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');

  await searchBox(page).press('ArrowDown');
  await expect(results(page)).toBeVisible();
  // The page's top corner (the header logo), well away from the list.
  await page.mouse.click(4, 4);
  await expect(results(page)).toBeHidden();
});

test('a coach, whose sidebar has none of these pages, gets no search box', async ({ page }) => {
  const coach = await addPerson('Cody', 'Coach', [{ role: 'INSTRUCTOR', schoolId: s.schoolId }]);
  await signIn(page, coach.token);
  await page.goto('/coach');
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Students' })).toHaveCount(0);
});

test('works in Portuguese', async ({ page }) => {
  const student = await addStudent(s, word, 'Aluno', { rung: 'White 1' });
  await db.user.update({ where: { id: s.ownerId }, data: { language: 'pt-BR' } });
  await signIn(page, s.ownerToken);
  await page.goto('/dashboard');

  const box = page.getByRole('combobox', { name: 'Pesquisar', exact: true });
  await expect(box).toHaveAttribute('placeholder', 'Pesquisar por nome…');
  await box.fill(word);
  const list = page.getByRole('listbox', { name: 'Resultados da pesquisa' });
  await expect(list.getByRole('group', { name: 'Alunos' }).getByRole('option', { name: student.name })).toBeVisible();

  await box.fill(`${word}-ninguem`);
  await expect(page.getByRole('status').filter({ hasText: `Nenhum resultado para “${word}-ninguem”` })).toBeVisible();
});
