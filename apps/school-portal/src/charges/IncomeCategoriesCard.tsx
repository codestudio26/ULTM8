import React, { useState } from 'react';
import { Button, Card, ErrorBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import {
  INCOME_CATEGORY_NAME_MAX,
  useCreateIncomeCategory,
  useDeleteIncomeCategory,
  useIncomeCategories,
  useRenameIncomeCategory,
  type IncomeCategory,
} from './incomeCategoryQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Decision 316 item 10: the School's own income categories. The owner adds,
 * renames and deletes them; a plan or a charge can carry one, and the
 * Transactions export shows it. One in use can't be deleted, only renamed.
 * No accounting codes and no accounting integration yet.
 */
export function IncomeCategoriesCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const categories = useIncomeCategories(schoolId);
  const create = useCreateIncomeCategory(schoolId);
  const [name, setName] = useState('');
  if (categories.isError) return null;
  const items = categories.data?.items ?? [];

  return (
    <Card>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('charges.incomeCategories.title')}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('charges.incomeCategories.subtitle')}</p>
      {create.error ? <ErrorBanner message={errorText(create.error, t('common.tryAgain'))} /> : null}
      {items.length === 0 ? <p className="ultm8-field__hint">{t('charges.incomeCategories.empty')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((category) => (
          <CategoryRow key={`${category.id}-${category.name}`} schoolId={schoolId} category={category} />
        ))}
      </ul>
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (clean(name)) create.mutate(clean(name), { onSuccess: () => setName('') });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField
            aria-label={t('charges.incomeCategories.newLabel')}
            placeholder={t('charges.incomeCategories.placeholder')}
            maxLength={INCOME_CATEGORY_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!clean(name)} loading={create.isPending}>
          {t('charges.incomeCategories.add')}
        </Button>
      </form>
    </Card>
  );
}

function CategoryRow({ schoolId, category }: { schoolId: string; category: IncomeCategory }) {
  const t = useT();
  const rename = useRenameIncomeCategory(schoolId);
  const remove = useDeleteIncomeCategory(schoolId);
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);
  const error = rename.error ?? remove.error;
  const changed = clean(name) !== '' && clean(name) !== category.name;
  const inUse = category.useCount > 0;

  return (
    <li>
      {error ? <ErrorBanner message={errorText(error, t('common.tryAgain'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename.mutate({ categoryId: category.id, name: clean(name) });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField
            aria-label={t('charges.incomeCategories.nameLabel', { name: category.name })}
            maxLength={INCOME_CATEGORY_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <span className="ultm8-field__hint">{t('charges.incomeCategories.useCount', { count: category.useCount })}</span>
        <Button type="submit" variant="secondary" disabled={!changed} loading={rename.isPending}>
          {t('charges.incomeCategories.rename')}
        </Button>
        {inUse ? null : confirming ? (
          <>
            <span>{t('charges.incomeCategories.confirmDelete')}</span>
            <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(category.id)}>
              {t('charges.incomeCategories.delete')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('charges.incomeCategories.delete')}
          </Button>
        )}
      </form>
    </li>
  );
}
