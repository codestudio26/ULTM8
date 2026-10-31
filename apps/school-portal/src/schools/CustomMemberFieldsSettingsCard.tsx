import React, { useState } from 'react';
import { Button, Card, ErrorBanner, Field, SelectField, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import {
  CUSTOM_FIELD_TYPES,
  CUSTOM_NAME_MAX,
  useCreateCustomField,
  useCreateCustomStatus,
  useCustomMemberFields,
  useCustomMemberStatuses,
  useDeleteCustomField,
  useDeleteCustomStatus,
  useRenameCustomStatus,
  useReorderCustomFields,
  useUpdateCustomField,
  type CustomMemberField,
  type CustomMemberFieldType,
  type CustomMemberStatus,
} from '../students/customMemberFieldsQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
/** A drop-down's choices, typed one per line. */
const choicesOf = (text: string) => text.split('\n').map(clean).filter(Boolean);

/**
 * Decision 315 item 14: the School's own member fields (text, number, date,
 * drop-down, yes/no) and member statuses (up to 50 characters). Fields can be
 * added, renamed, reordered and deleted (deleting one deletes every student's
 * value); statuses added, renamed and deleted (deleting one clears it from
 * every student). Members never see either.
 */
export function CustomMemberFieldsSettingsCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const fields = useCustomMemberFields(schoolId);
  const statuses = useCustomMemberStatuses(schoolId);
  if (fields.isError || statuses.isError) return null;

  return (
    <Card>
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('schools.customFields.title')}</h2>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('schools.customFields.subtitle')}</p>
      <FieldsSection schoolId={schoolId} items={fields.data?.items ?? []} />
      <StatusesSection schoolId={schoolId} items={statuses.data?.items ?? []} />
    </Card>
  );
}

function FieldsSection({ schoolId, items }: { schoolId: string; items: CustomMemberField[] }) {
  const t = useT();
  const create = useCreateCustomField(schoolId);
  const reorder = useReorderCustomFields(schoolId);
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomMemberFieldType>('TEXT');
  const [choices, setChoices] = useState('');
  const ready = clean(name) !== '' && (type !== 'DROPDOWN' || choicesOf(choices).length > 0);
  const error = create.error ?? reorder.error;

  const move = (index: number, by: -1 | 1) => {
    const ids = items.map((f) => f.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('schools.customFields.fieldsTitle')}</h3>
      {error ? <ErrorBanner message={errorText(error, t('schools.customFields.failed'))} /> : null}
      {items.length === 0 ? <p className="ultm8-field__hint">{t('schools.customFields.fieldsEmpty')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((field, index) => (
          <FieldRow
            key={`${field.id}-${field.name}-${field.options.join('|')}`}
            schoolId={schoolId}
            field={field}
            onUp={index > 0 ? () => move(index, -1) : undefined}
            onDown={index < items.length - 1 ? () => move(index, 1) : undefined}
            moving={reorder.isPending}
          />
        ))}
      </ul>
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          create.mutate(
            { name: clean(name), type, ...(type === 'DROPDOWN' ? { options: choicesOf(choices) } : {}) },
            {
              onSuccess: () => {
                setName('');
                setChoices('');
              },
            },
          );
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Field label={t('schools.customFields.newFieldLabel')} htmlFor="custom-field-new-name">
            <TextField id="custom-field-new-name" maxLength={CUSTOM_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <Field label={t('schools.customFields.typeLabel')} htmlFor="custom-field-new-type">
            <SelectField
              id="custom-field-new-type"
              value={type}
              onChange={(e) => setType(e.target.value as CustomMemberFieldType)}
              options={CUSTOM_FIELD_TYPES.map((value) => ({ value, label: t(`schools.customFields.types.${value}`) }))}
            />
          </Field>
        </div>
        {type === 'DROPDOWN' ? (
          <div style={{ flex: '1 1 100%' }}>
            <Field label={t('schools.customFields.optionsLabel')} htmlFor="custom-field-new-options">
              <TextArea id="custom-field-new-options" rows={3} value={choices} onChange={(e) => setChoices(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <div style={{ paddingBottom: 8 }}>
          <Button type="submit" variant="secondary" disabled={!ready} loading={create.isPending}>
            {t('schools.customFields.addField')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function FieldRow({ schoolId, field, onUp, onDown, moving }: { schoolId: string; field: CustomMemberField; onUp?: () => void; onDown?: () => void; moving: boolean }) {
  const t = useT();
  const update = useUpdateCustomField(schoolId);
  const remove = useDeleteCustomField(schoolId);
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join('\n'));
  const [confirming, setConfirming] = useState(false);
  const error = update.error ?? remove.error;
  const nameChanged = clean(name) !== '' && clean(name) !== field.name;
  const choicesChanged = field.type === 'DROPDOWN' && choicesOf(choices).length > 0 && choicesOf(choices).join('\n') !== field.options.join('\n');

  return (
    <li>
      {error ? <ErrorBanner message={errorText(error, t('schools.customFields.failed'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (nameChanged || choicesChanged) {
            update.mutate({ fieldId: field.id, ...(nameChanged ? { name: clean(name) } : {}), ...(choicesChanged ? { options: choicesOf(choices) } : {}) });
          }
        }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <TextField aria-label={t('schools.customFields.nameLabel', { field: field.name })} maxLength={CUSTOM_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="ultm8-badge">{t(`schools.customFields.types.${field.type}`)}</span>
        <Button type="button" variant="secondary" aria-label={t('schools.customFields.moveUp', { field: field.name })} disabled={!onUp || moving} onClick={onUp}>
          ↑
        </Button>
        <Button type="button" variant="secondary" aria-label={t('schools.customFields.moveDown', { field: field.name })} disabled={!onDown || moving} onClick={onDown}>
          ↓
        </Button>
        <Button type="submit" variant="secondary" disabled={!nameChanged && !choicesChanged} loading={update.isPending}>
          {t('schools.customFields.save')}
        </Button>
        {confirming ? (
          <>
            <span>{t('schools.customFields.confirmDeleteField')}</span>
            <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(field.id)}>
              {t('schools.customFields.delete')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('schools.customFields.delete')}
          </Button>
        )}
        {field.type === 'DROPDOWN' ? (
          <div style={{ flex: '1 1 100%' }}>
            <Field label={t('schools.customFields.optionsLabel')} htmlFor={`custom-field-${field.id}-options`} hint={t('schools.customFields.optionsHint')}>
              <TextArea id={`custom-field-${field.id}-options`} rows={3} value={choices} onChange={(e) => setChoices(e.target.value)} />
            </Field>
          </div>
        ) : null}
      </form>
    </li>
  );
}

function StatusesSection({ schoolId, items }: { schoolId: string; items: CustomMemberStatus[] }) {
  const t = useT();
  const create = useCreateCustomStatus(schoolId);
  const [name, setName] = useState('');

  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('schools.customFields.statusesTitle')}</h3>
      {create.error ? <ErrorBanner message={errorText(create.error, t('schools.customFields.failed'))} /> : null}
      {items.length === 0 ? <p className="ultm8-field__hint">{t('schools.customFields.statusesEmpty')}</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((status) => (
          <StatusRow key={`${status.id}-${status.name}`} schoolId={schoolId} status={status} />
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
            aria-label={t('schools.customFields.newStatusLabel')}
            placeholder={t('schools.customFields.statusPlaceholder')}
            maxLength={CUSTOM_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!clean(name)} loading={create.isPending}>
          {t('schools.customFields.addStatus')}
        </Button>
      </form>
    </section>
  );
}

function StatusRow({ schoolId, status }: { schoolId: string; status: CustomMemberStatus }) {
  const t = useT();
  const rename = useRenameCustomStatus(schoolId);
  const remove = useDeleteCustomStatus(schoolId);
  const [name, setName] = useState(status.name);
  const [confirming, setConfirming] = useState(false);
  const error = rename.error ?? remove.error;
  const changed = clean(name) !== '' && clean(name) !== status.name;

  return (
    <li>
      {error ? <ErrorBanner message={errorText(error, t('schools.customFields.failed'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename.mutate({ statusId: status.id, name: clean(name) });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField aria-label={t('schools.customFields.statusNameLabel', { status: status.name })} maxLength={CUSTOM_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="ultm8-field__hint">{t('schools.customFields.statusCount', { count: status.studentCount })}</span>
        <Button type="submit" variant="secondary" disabled={!changed} loading={rename.isPending}>
          {t('schools.customFields.rename')}
        </Button>
        {confirming ? (
          <>
            <span>{t('schools.customFields.confirmDeleteStatus')}</span>
            <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(status.id)}>
              {t('schools.customFields.delete')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('schools.customFields.delete')}
          </Button>
        )}
      </form>
    </li>
  );
}
