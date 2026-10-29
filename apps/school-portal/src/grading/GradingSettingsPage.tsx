import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, SelectField, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import {
  useMyGrading,
  useOpenMatHours,
  usePromotionFeeSettings,
  useSetAnyBoardThresholds,
  useSetOpenMatHours,
  useSetRankDisplay,
  useSetReadyForAdultAge,
  useUpdatePromotionFeeSettings,
} from './gradingQueries';
import { GradingTabs } from './GradingTabs';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

type About = 'display' | 'columns' | 'fee' | 'gradeBeforePaid' | 'openMat' | 'who';

const ABOUT: Record<About, { title: TranslationKey; body: TranslationKey }> = {
  display: { title: 'grading.settings.displayTitle', body: 'grading.settings.about.display' },
  columns: { title: 'grading.settings.columns.title', body: 'grading.settings.about.columns' },
  fee: { title: 'grading.settings.fee.enabled', body: 'grading.settings.about.fee' },
  gradeBeforePaid: { title: 'grading.settings.fee.gradeBeforePaid', body: 'grading.settings.about.gradeBeforePaid' },
  openMat: { title: 'grading.settings.openMat.label', body: 'grading.settings.about.openMat' },
  who: { title: 'grading.settings.who.title', body: 'grading.settings.about.who' },
};

/**
 * Grading → Settings (DESIGN.md → "Grading screens", Settings tab): sections of
 * settings with an "About this setting" panel, and one Discard / Save changes
 * bar. Board columns per style (the owner, or a coach with "Change board %"
 * for that style); the promotion fee for the whole school (owner only,
 * Decisions 297, 300, 307); and "Open mat counts toward hours" (the owner, or
 * a coach with "Change board %" for any style; Decisions 301, 304, 306).
 * A Kids style linked to its Adult style also has "Ready for Adult from age"
 * (backlog 3.20; Decision 285 items 2 and 4), with the same right as its
 * columns. "Ranks shown as" Belts or Levels per style (Decision 290), with
 * the same right too.
 */
export function GradingSettingsPage() {
  const schoolId = useGradingSchoolId();
  const t = useT();
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const fee = usePromotionFeeSettings(schoolId);
  const openMat = useOpenMatHours(schoolId);
  const updateFee = useUpdatePromotionFeeSettings(schoolId ?? '');
  const setOpenMat = useSetOpenMatHours(schoolId ?? '');
  const setThresholds = useSetAnyBoardThresholds();
  const setAdultAge = useSetReadyForAdultAge();
  const setRankDisplay = useSetRankDisplay();
  const styles = useMemo(() => (disciplines.data?.items ?? []).filter((d) => !d.archivedAt && my.mayGradeStyle(d.id)), [disciplines.data, my]);

  // The page's working copy; Save sends only what changed.
  const [columns, setColumns] = useState<Record<string, { g: string; r: string }>>({});
  const [adultAges, setAdultAges] = useState<Record<string, string>>({});
  const [displays, setDisplays] = useState<Record<string, DisciplineResponse['rankDisplay']>>({});
  const [feeOn, setFeeOn] = useState(false);
  const [beforePaid, setBeforePaid] = useState(false);
  const [openMatOn, setOpenMatOn] = useState(false);
  const [about, setAbout] = useState<About>('columns');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reset = () => {
    setColumns(Object.fromEntries(styles.map((d) => [d.id, { g: String(d.boardGettingThere), r: String(d.boardReadyToGrade) }])));
    setAdultAges(Object.fromEntries(styles.map((d) => [d.id, String(d.readyForAdultAge)])));
    setDisplays(Object.fromEntries(styles.map((d) => [d.id, d.rankDisplay])));
    setFeeOn(fee.data?.promotionFeeEnabled ?? false);
    setBeforePaid(fee.data?.gradeBeforeFeePaid ?? false);
    setOpenMatOn(openMat.data?.openMatCountsTowardHours ?? false);
  };
  // Reset when the saved values change, not on every render (the style list is rebuilt each time).
  const savedKey = styles.map((d) => `${d.id}:${d.boardGettingThere}:${d.boardReadyToGrade}:${d.readyForAdultAge}:${d.rankDisplay}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [savedKey, fee.data, openMat.data]);

  if (!schoolId) return null;
  if (my.isLoading || disciplines.isLoading || fee.isLoading || openMat.isLoading) return <Spinner />;
  const loadError = my.error ?? disciplines.error ?? fee.error ?? openMat.error;
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('grading.settings.loadFailed')} />;

  const canColumns = (d: DisciplineResponse) => my.can(d.id, 'canChangeBoardThresholds');
  const canOpenMat = my.isOwner || styles.some(canColumns);
  const columnProblem = (c: { g: string; r: string }) => {
    const g = Number(c.g);
    const r = Number(c.r);
    return Number.isInteger(g) && Number.isInteger(r) && g >= 1 && r <= 99 && g < r ? null : t('grading.board.thresholds.invalid');
  };
  const changedColumns = styles.filter((d) => {
    const c = columns[d.id];
    return c && canColumns(d) && (c.g !== String(d.boardGettingThere) || c.r !== String(d.boardReadyToGrade));
  });
  const ageProblem = (v: string) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 99 ? null : t('grading.settings.columns.adultAgeInvalid'));
  const changedAges = styles.filter((d) => d.adultDisciplineId && canColumns(d) && adultAges[d.id] !== undefined && adultAges[d.id] !== String(d.readyForAdultAge));
  const changedDisplays = styles.filter((d) => canColumns(d) && displays[d.id] !== undefined && displays[d.id] !== d.rankDisplay);
  const feeChanged = my.isOwner && (feeOn !== (fee.data?.promotionFeeEnabled ?? false) || beforePaid !== (fee.data?.gradeBeforeFeePaid ?? false));
  const openMatChanged = canOpenMat && openMatOn !== (openMat.data?.openMatCountsTowardHours ?? false);
  const dirty = changedColumns.length > 0 || changedAges.length > 0 || changedDisplays.length > 0 || feeChanged || openMatChanged;
  const invalid = changedColumns.some((d) => columnProblem(columns[d.id]) !== null) || changedAges.some((d) => ageProblem(adultAges[d.id]) !== null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      for (const d of changedColumns) {
        await setThresholds.mutateAsync({ disciplineId: d.id, gettingThere: Number(columns[d.id].g), readyToGrade: Number(columns[d.id].r) });
      }
      for (const d of changedAges) {
        await setAdultAge.mutateAsync({ disciplineId: d.id, age: Number(adultAges[d.id]) });
      }
      for (const d of changedDisplays) {
        await setRankDisplay.mutateAsync({ disciplineId: d.id, rankDisplay: displays[d.id] });
      }
      if (feeChanged) await updateFee.mutateAsync({ promotionFeeEnabled: feeOn, ...(feeOn ? { gradeBeforeFeePaid: beforePaid } : {}) });
      if (openMatChanged) await setOpenMat.mutateAsync(openMatOn);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  const aboutButton = (key: About) => (
    <Button variant="secondary" className="ultm8-about-button" onClick={() => setAbout(key)} aria-label={t('grading.settings.aboutAria', { setting: t(ABOUT[key].title) })}>
      ⓘ
    </Button>
  );

  return (
    <>
      <PageHeader title={t('grading.settings.title')} subtitle={t('grading.settings.subtitle')} />
      <GradingTabs />
      {error ? <ErrorBanner message={error} /> : null}
      {saved && !dirty ? <SuccessBanner message={t('grading.settings.saved')} /> : null}
      <div className="ultm8-settings-layout">
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          {styles.length ? (
            <Card>
              <section aria-label={t('grading.settings.displayTitle')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h2 className="ultm8-page-header__title" style={{ fontSize: 17, margin: 0, flex: 1 }}>
                    {t('grading.settings.displayTitle')}
                  </h2>
                  {aboutButton('display')}
                </div>
                <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                  {styles.map((d) => {
                    const editable = canColumns(d);
                    return (
                      <div key={d.id} className="ultm8-settings-row">
                        <label className="ultm8-settings-inline">
                          <strong>{d.name}</strong>
                          <SelectField
                            value={displays[d.id] ?? d.rankDisplay}
                            disabled={!editable}
                            aria-label={t('grading.settings.displayAria', { style: d.name })}
                            onChange={(e) => setDisplays((x) => ({ ...x, [d.id]: e.target.value as DisciplineResponse['rankDisplay'] }))}
                            options={[
                              { value: 'BELTS', label: t('disciplines.form.rankDisplayBelts') },
                              { value: 'LEVELS', label: t('disciplines.form.rankDisplayLevels') },
                            ]}
                          />
                        </label>
                        {editable ? null : <span className="ultm8-field__hint">{t('grading.settings.columns.noRight')}</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
            </Card>
          ) : null}
          <Card>
            <section aria-label={t('grading.settings.columns.title')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 className="ultm8-page-header__title" style={{ fontSize: 17, margin: 0, flex: 1 }}>
                  {t('grading.settings.columns.title')}
                </h2>
                {aboutButton('columns')}
              </div>
              <p className="ultm8-field__hint">{t('grading.settings.columns.intro')}</p>
              {styles.length === 0 ? (
                <EmptyState title={t('grading.noStylesTitle')} description={t('grading.board.noStylesDescription')} />
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {styles.map((d) => {
                    const c = columns[d.id] ?? { g: String(d.boardGettingThere), r: String(d.boardReadyToGrade) };
                    const editable = canColumns(d);
                    const problem = editable ? columnProblem(c) : null;
                    return (
                      <div key={d.id} className="ultm8-settings-row">
                        <strong style={{ flexBasis: "100%" }}>{d.name}</strong>
                        <label className="ultm8-settings-inline">
                          {t('grading.settings.columns.gettingThere')}
                          <TextField
                            type="number"
                            min={1}
                            max={98}
                            value={c.g}
                            disabled={!editable}
                            aria-label={t('grading.settings.columns.gettingThereAria', { style: d.name })}
                            onChange={(e) => setColumns((x) => ({ ...x, [d.id]: { ...c, g: e.target.value } }))}
                          />
                        </label>
                        <label className="ultm8-settings-inline">
                          {t('grading.settings.columns.readyToGrade')}
                          <TextField
                            type="number"
                            min={2}
                            max={99}
                            value={c.r}
                            disabled={!editable}
                            aria-label={t('grading.settings.columns.readyToGradeAria', { style: d.name })}
                            onChange={(e) => setColumns((x) => ({ ...x, [d.id]: { ...c, r: e.target.value } }))}
                          />
                        </label>
                        {d.adultDisciplineId ? (
                          <label className="ultm8-settings-inline">
                            {t('grading.settings.columns.adultAge')}
                            <TextField
                              type="number"
                              min={1}
                              max={99}
                              value={adultAges[d.id] ?? String(d.readyForAdultAge)}
                              disabled={!editable}
                              aria-label={t('grading.settings.columns.adultAgeAria', { style: d.name })}
                              onChange={(e) => setAdultAges((x) => ({ ...x, [d.id]: e.target.value }))}
                            />
                          </label>
                        ) : null}
                        {d.adultDisciplineId && editable && adultAges[d.id] !== undefined && ageProblem(adultAges[d.id]) ? (
                          <p role="alert" className="ultm8-field__error" style={{ flexBasis: '100%', margin: 0 }}>
                            {ageProblem(adultAges[d.id])}
                          </p>
                        ) : null}
                        {editable ? null : <span className="ultm8-field__hint">{t('grading.settings.columns.noRight')}</span>}
                        {problem ? (
                          <p role="alert" className="ultm8-field__error" style={{ flexBasis: '100%', margin: 0 }}>
                            {problem}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </Card>

          <Card>
            <section aria-label={t('grading.settings.fee.title')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 className="ultm8-page-header__title" style={{ fontSize: 17, margin: 0, flex: 1 }}>
                  {t('grading.settings.fee.title')} <Badge>{t('grading.settings.ownerOnly')}</Badge>
                </h2>
                {aboutButton('fee')}
              </div>
              {my.isOwner ? null : <p className="ultm8-field__hint">{t('grading.settings.fee.coachNote')}</p>}
              <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
                <Switch
                  id="fee-enabled"
                  label={t('grading.settings.fee.enabled')}
                  description={feeOn ? t('grading.settings.fee.enabledOn') : t('grading.settings.fee.enabledOff')}
                  checked={feeOn}
                  disabled={!my.isOwner}
                  onChange={(v) => {
                    setFeeOn(v);
                    setAbout('fee');
                  }}
                />
                {feeOn ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <Switch
                          id="fee-before-paid"
                          label={t('grading.settings.fee.gradeBeforePaid')}
                          description={beforePaid ? t('grading.settings.fee.gradeBeforePaidOn') : t('grading.settings.fee.gradeBeforePaidOff')}
                          checked={beforePaid}
                          disabled={!my.isOwner}
                          onChange={(v) => {
                            setBeforePaid(v);
                            setAbout('gradeBeforePaid');
                          }}
                        />
                      </div>
                      {aboutButton('gradeBeforePaid')}
                    </div>
                    <div className="ultm8-settings-row">
                      <span style={{ flex: 1 }}>
                        <strong>{t('grading.settings.fee.prices')}</strong>
                      </span>
                      <Link to="/disciplines">{t('grading.settings.fee.pricesLink')}</Link>
                    </div>
                    <div className="ultm8-settings-row">
                      <span style={{ flex: 1 }}>
                        <strong>{t('grading.settings.fee.accepts')}</strong>
                      </span>
                      <Badge>{t('grading.settings.fee.alwaysOn')}</Badge>
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </Card>

          <Card>
            <section aria-label={t('grading.settings.wholeSchool')}>
              <h2 className="ultm8-page-header__title" style={{ fontSize: 17, margin: 0 }}>
                {t('grading.settings.wholeSchool')}
              </h2>
              <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Switch
                      id="open-mat-hours"
                      label={t('grading.settings.openMat.label')}
                      description={t('grading.settings.openMat.hint')}
                      checked={openMatOn}
                      disabled={!canOpenMat}
                      onChange={(v) => {
                        setOpenMatOn(v);
                        setAbout('openMat');
                      }}
                    />
                  </div>
                  {aboutButton('openMat')}
                </div>
                <div className="ultm8-settings-row">
                  <span style={{ flex: 1 }}>
                    <strong>{t('grading.settings.who.title')}</strong>
                    <div className="ultm8-field__hint">{t('grading.settings.who.hint')}</div>
                  </span>
                  {my.isOwner ? <Link to="/grading/permissions">{t('grading.settings.who.link')}</Link> : null}
                </div>
              </div>
            </section>
          </Card>
        </div>

        <aside className="ultm8-board-panel">
          <Card>
            <section aria-label={t('grading.settings.aboutTitle')}>
              <div className="label ultm8-field__hint" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
                {t('grading.settings.aboutTitle')}
              </div>
              <h3 style={{ fontSize: 16, margin: '4px 0 8px' }}>{t(ABOUT[about].title)}</h3>
              <p style={{ margin: 0 }}>{t(ABOUT[about].body)}</p>
            </section>
          </Card>
        </aside>
      </div>

      {dirty ? (
        <div className="ultm8-save-bar" role="region" aria-label={t('grading.settings.unsaved')}>
          <span className="ultm8-field__hint" style={{ flex: 1 }}>
            {t('grading.settings.unsaved')}
          </span>
          <Button variant="secondary" onClick={reset} disabled={saving}>
            {t('grading.settings.discard')}
          </Button>
          <Button onClick={save} loading={saving} disabled={invalid}>
            {t('grading.settings.save')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
