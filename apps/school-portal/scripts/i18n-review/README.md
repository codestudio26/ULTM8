# Translation review

Native speakers check the wording of the School Portal and the student app on a
shared review page (a Claude artifact) without using either app: each distinct
English text once per language, however many screens in either app use it,
several reviewers at a time, with Claude pre-checking and answering questions
on the page. Their checks are saved in the page's shared list, which Claude
reads back and turns into a change to the translation files: a key listed as
`studentApp.<key>` is in `apps/student/src/i18n/messages/`, any other key in
`apps/school-portal/src/i18n/messages/`, and an error message in
`packages/i18n/src/server/` (Decision 323).

Refresh the texts on the page after strings change:

```sh
cd apps/school-portal
npx tsx scripts/i18n-review/export.ts <out-dir>
```

Then republish the page with the new `<out-dir>/data/*.json`. A review is keyed
by the English text, so it carries over when only the translation changed.
Before launch the review starts from zero (Decision 323): clear the page's
saved reviews first.
