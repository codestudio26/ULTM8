import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, ModalActions, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCreateFromTemplate, useDuplicateDiscipline, useStyleTemplates, type DisciplineResponse, type StyleTemplateId } from './disciplineQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import './stylesLook.css';

/** Templates this app has its own (translated) wording for; any other id the
 * API adds later shows the API's text. */
const TEMPLATE_KEYS: Record<StyleTemplateId, true> = { ibjjf: true, ibjjf_kids_red: true, ibjjf_kids_yellow: true };

const errorText = (err: unknown, t: TranslateFn) => (err instanceof ApiError ? err.message : t('common.tryAgain'));

/** "Start from template" (Decisions 131, 182): one of the three IBJJF ladders
 * with the prototype's numbers, which the school then edits as its own.
 * New look (Decision 460): each template is an option card (a choice that
 * needs a line of explanation, DESIGN.md → Form pattern "F"), still a radio
 * button; the buttons sit in the dialog's band, Cancel first. */
export function TemplateModal({ schoolId, onCreated, onClose }: { schoolId: string; onCreated: (id: string) => void; onClose: () => void }) {
  const t = useT();
  const { data, isLoading, error: loadError } = useStyleTemplates();
  const create = useCreateFromTemplate(schoolId);
  const [templateId, setTemplateId] = useState<StyleTemplateId | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const templates = data?.items ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return;
    setError(null);
    try {
      // Left blank, the style is named after the template as this screen shows it.
      // The API would use its own English name, which in another language isn't
      // the name the owner just picked.
      const shownName = formatLocale() && templateId in TEMPLATE_KEYS ? t(`disciplines.template.options.${templateId}.name`) : '';
      const chosen = name.trim() || shownName;
      const style = await create.mutateAsync({ templateId, ...(chosen ? { name: chosen } : {}) });
      onCreated(style.id);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('disciplines.template.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {loadError ? <ErrorBanner message={errorText(loadError, t)} /> : null}
        <p className="u8gs-intro">{t('disciplines.template.intro')}</p>
        {isLoading ? (
          <Spinner />
        ) : (
          <fieldset className="u8gs-fieldset">
            <legend className="ultm8-field__label">{t('disciplines.template.templateLegend')}</legend>
            <div className="u8gs-options">
              {templates.map((tpl) => (
                <label key={tpl.id} className="u8gs-option">
                  <input
                    type="radio"
                    className="u8gs-radio"
                    name="template"
                    value={tpl.id}
                    checked={templateId === tpl.id}
                    onChange={() => setTemplateId(tpl.id as StyleTemplateId)}
                  />
                  <span className="u8gs-option__text">
                    <strong>{tpl.id in TEMPLATE_KEYS ? t(`disciplines.template.options.${tpl.id as StyleTemplateId}.name`) : tpl.name}</strong>
                    <span>{tpl.id in TEMPLATE_KEYS ? t(`disciplines.template.options.${tpl.id as StyleTemplateId}.description`) : tpl.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label={t('disciplines.template.nameLabel')} htmlFor="template-style-name" hint={t('disciplines.template.nameHint')}>
          <TextField value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!templateId}>
            {t('disciplines.template.create')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

/** "Duplicate" (Decision 182): the ladder, skills and settings, no students. */
export function DuplicateModal({
  schoolId,
  discipline,
  onCreated,
  onClose,
}: {
  schoolId: string;
  discipline: DisciplineResponse;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const duplicate = useDuplicateDiscipline(schoolId);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setError(null);
    try {
      const copy = await duplicate.mutateAsync(discipline.id);
      onCreated(copy.id);
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Modal title={t('disciplines.duplicate.title', { name: discipline.name })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <p className="u8gs-intro">
        {/* The API always names the copy "… (Copy)", whatever the language. */}
        {t('disciplines.duplicate.description', { copyName: `${discipline.name} (Copy)` })}
      </p>
      <ModalActions>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="button" onClick={confirm} loading={duplicate.isPending}>
          {t('disciplines.duplicate.confirm')}
        </Button>
      </ModalActions>
    </Modal>
  );
}
