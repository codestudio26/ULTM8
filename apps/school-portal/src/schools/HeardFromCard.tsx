import React, { useState } from 'react';
import { Button, Card, ErrorBanner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { defaultHeardFrom } from '../frontdesk/heardFrom';
import { useUpdateSchool, type SchoolResponse } from './schoolQueries';

const MAX_CHOICES = 30;

/**
 * Decision 392 (Decision 315 item 6): the School's own "How did you hear
 * about us?" list, asked on the front-desk tablet's sign-up. Until the School
 * edits it, the starting list shows in each viewer's language; saving keeps
 * the list as written here. Choices can be added, renamed, moved and removed.
 */
export function HeardFromCard({ schoolId, school }: { schoolId: string; school: SchoolResponse }) {
  const t = useT();
  const update = useUpdateSchool(schoolId);
  const [choices, setChoices] = useState<string[]>(() => school.heardFromOptions ?? defaultHeardFrom(t));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const edited = school.heardFromOptions !== null && school.heardFromOptions !== undefined;

  const cleaned = choices.map((c) => c.trim());
  const duplicate = cleaned.some((c, i) => c && cleaned.findIndex((d) => d.toLowerCase() === c.toLowerCase()) !== i);
  const valid = cleaned.length > 0 && cleaned.every((c) => c.length > 0 && c.length <= 60) && !duplicate;

  function change(next: string[]) {
    setChoices(next);
    setSaved(false);
  }

  async function save(body: { heardFromOptions: string[] | null }) {
    setError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync(body);
      setChoices(updated.heardFromOptions ?? defaultHeardFrom(t));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Card>
      <form
        id="heard-from"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void save({ heardFromOptions: cleaned });
        }}
      >
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.heardFrom.title')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.heardFrom.subtitle')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('schools.profile.saved')} /> : null}
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {choices.map((choice, i) => (
            <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <TextField
                  aria-label={t('schools.heardFrom.choiceAria', { n: i + 1 })}
                  value={choice}
                  maxLength={60}
                  onChange={(e) => change(choices.map((c, j) => (j === i ? e.target.value : c)))}
                />
              </div>
              <Button type="button" variant="secondary" disabled={i === 0} aria-label={t('schools.heardFrom.moveUp', { choice })} onClick={() => change(swap(choices, i, i - 1))}>
                ↑
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={i === choices.length - 1}
                aria-label={t('schools.heardFrom.moveDown', { choice })}
                onClick={() => change(swap(choices, i, i + 1))}
              >
                ↓
              </Button>
              <Button type="button" variant="secondary" disabled={choices.length === 1} onClick={() => change(choices.filter((_, j) => j !== i))}>
                {t('schools.heardFrom.remove')}
              </Button>
            </li>
          ))}
        </ol>
        {duplicate ? <p style={{ color: 'var(--text-danger)', margin: '8px 0 0' }}>{t('schools.heardFrom.duplicate')}</p> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Button type="button" variant="secondary" disabled={choices.length >= MAX_CHOICES} onClick={() => change([...choices, ''])}>
            {t('schools.heardFrom.add')}
          </Button>
          <Button type="submit" loading={update.isPending} disabled={!valid}>
            {t('schools.profile.saveChanges')}
          </Button>
          {edited ? (
            <Button type="button" variant="secondary" onClick={() => void save({ heardFromOptions: null })}>
              {t('schools.heardFrom.reset')}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function swap(list: string[], a: number, b: number): string[] {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
