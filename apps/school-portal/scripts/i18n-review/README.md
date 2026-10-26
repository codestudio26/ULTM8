# Translation review

Native speakers check the School Portal's wording on a shared review page
(a Claude artifact) without using the app: each distinct English text once per
language, several reviewers at a time, with Claude pre-checking and answering
questions on the page. Their checks are saved in the page's shared list, which
Claude reads back and turns into a change to `src/i18n/messages/*.ts`.

Refresh the texts on the page after strings change:

```sh
cd apps/school-portal
npx tsx scripts/i18n-review/export.ts <out-dir>
```

Then republish the page with the new `<out-dir>/data/*.json`. A review is keyed
by the English text, so it carries over when only the translation changed.
