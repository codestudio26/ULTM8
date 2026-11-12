import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { Button, ErrorBanner, Field, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { apiClient } from '../api';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { errorText } from './frontDeskQueries';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import { checkInRulesBody, toCheckInRulesForm as toForm, type CheckInRules, type CheckInRulesForm as Form } from './checkInRulesForm';
import '../students/studentsList.css';
import './frontDesk.css';
import '../profile/settingsForms.css';

export function useCheckInRules(schoolId: string | null) {
  return useQuery({
    queryKey: ['check-in-rules', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/check-in-rules', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/**
 * Check-in → Check-in rules (Decision 394, front-desk handover F9). One set
 * of rules for every way in: the app QR and code, the coach's scan, the
 * front desk and the locked tablet. Every default is what check-in did
 * before. The owner, and Branch Staff the owner switches on, change them.
 */
export function CheckInRulesPage() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const queryClient = useQueryClient();
  const rules = useCheckInRules(schoolId);
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: CheckInRules) => unwrap(apiClient.PUT('/v1/schools/{schoolId}/check-in-rules', { params: { path: { schoolId: schoolId! } }, body })),
    onSuccess: (r) => {
      setForm(toForm(r));
      setSaved(true);
      queryClient.setQueryData(['check-in-rules', schoolId], r);
      // The desk reads the opening and closing times off the School.
      queryClient.invalidateQueries({ queryKey: ['school', schoolId] });
    },
  });

  useEffect(() => {
    if (rules.data && !form) setForm(toForm(rules.data));
  }, [rules.data, form]);

  if (!schoolId) return null;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, [key]: value } : f));
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaved(false);
    save.mutate(checkInRulesBody(form));
  }

  // The new look (Decisions 453, 460 item 17): the settings in white cards,
  // each under a small uppercase heading, as the design's Settings →
  // Check-in rules; the same rules, values and Save as before.
  return (
    <>
      <NewLookPageHeader
        title={t('frontDesk.rules.title')}
        subtitle={t('frontDesk.rules.subtitle')}
        actions={
          <Link to="/check-in" className="u8n-pill">
            {t('frontDesk.rules.back')}
          </Link>
        }
      />
      <NewLookPage>
        {rules.isLoading ? (
          <Spinner />
        ) : rules.error ? (
          <ErrorBanner message={errorText(rules.error, t('frontDesk.rules.loadFailed'))} />
        ) : form ? (
          <form className="u8me-settings" onSubmit={handleSubmit} data-testid="check-in-rules">
            {saved ? <SuccessBanner message={t('frontDesk.rules.saved')} /> : null}
            {save.error ? <ErrorBanner message={errorText(save.error, t('frontDesk.rules.saveFailed'))} /> : null}
            <SettingsGroup icon="when" title={t('frontDesk.rules.whenHeading')}>
              <div className="u8me-fields">
                <Field label={t('frontDesk.rules.opens')} htmlFor="rules-opens" hint={t('frontDesk.rules.opensHint')}>
                  <TextField
                    id="rules-opens"
                    type="number"
                    min={0}
                    max={1440}
                    step={1}
                    required
                    value={form.opensMinutesBeforeStart}
                    onChange={(e) => set('opensMinutesBeforeStart', e.target.value)}
                  />
                </Field>
                <div className="u8n-dd-field">
                  <NewLookSelect
                    id="rules-closes"
                    label={t('frontDesk.rules.closes')}
                    value={form.closes}
                    onChange={(v) => set('closes', v === 'after' ? 'after' : 'end')}
                    options={[
                      { value: 'end', label: t('frontDesk.rules.closesAtEnd') },
                      { value: 'after', label: t('frontDesk.rules.closesAfterStart') },
                    ]}
                  />
                  <span className="ultm8-field__hint u8n-dd-field__hint">{t('frontDesk.rules.closesHint')}</span>
                </div>
                {form.closes === 'after' ? (
                  <Field label={t('frontDesk.rules.closesMinutes')} htmlFor="rules-closes-minutes">
                    <TextField
                      id="rules-closes-minutes"
                      type="number"
                      min={0}
                      max={1440}
                      step={1}
                      required
                      value={form.closesMinutesAfterStart}
                      onChange={(e) => set('closesMinutesAfterStart', e.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
            </SettingsGroup>

            <SettingsGroup icon="who" title={t('frontDesk.rules.whoHeading')}>
              {/* Decision 422 item 2: off by default, so a booking is still needed. */}
              <Switch
                id="rules-without-booking"
                label={t('frontDesk.rules.withoutBooking')}
                description={t('frontDesk.rules.withoutBookingHint')}
                checked={form.withoutBooking}
                onChange={(on) => set('withoutBooking', on)}
              />
              {/* Decision 441 item 5: "Waiver must be signed before booking or check-in", on by default. */}
              <Switch
                id="rules-waiver"
                label={t('frontDesk.rules.requireWaiver')}
                description={t('frontDesk.rules.requireWaiverHint')}
                checked={form.requireWaiver}
                onChange={(on) => set('requireWaiver', on)}
              />
              <Switch
                id="rules-other-branches"
                label={t('frontDesk.rules.otherBranches')}
                description={t('frontDesk.rules.otherBranchesHint')}
                checked={form.otherBranches}
                onChange={(on) => set('otherBranches', on)}
              />
              <Switch
                id="rules-visitors"
                label={t('frontDesk.rules.visitors')}
                description={t('frontDesk.rules.visitorsHint')}
                checked={form.visitors}
                onChange={(on) => set('visitors', on)}
              />
              {/* Decision 404: off by default. */}
              <Switch
                id="rules-frozen-members"
                label={t('frontDesk.rules.frozenMembers')}
                description={t('frontDesk.rules.frozenMembersHint')}
                checked={form.frozenMembers ?? false}
                onChange={(on) => set('frozenMembers', on)}
              />
              {/* Decision 304 item 3: on by default, so open mat uses a credit like any class. */}
              <Switch
                id="rules-open-mat-credit"
                label={t('frontDesk.rules.openMatUsesCredit')}
                description={t('frontDesk.rules.openMatUsesCreditHint')}
                checked={form.openMatUsesCredit ?? true}
                onChange={(on) => set('openMatUsesCredit', on)}
              />
              {/* Backlog §3.5: No by default (an overdue payment never stopped a check-in). */}
              <div className="u8n-dd-field u8me-setting-choice">
                <NewLookSelect
                  id="rules-overdue"
                  label={t('frontDesk.rules.overdue')}
                  value={form.overdue}
                  onChange={(v) => set('overdue', v === '7' ? '7' : v === '14' ? '14' : 'no')}
                  options={[
                    { value: 'no', label: t('frontDesk.rules.overdueNo') },
                    { value: '7', label: t('frontDesk.rules.overdue7') },
                    { value: '14', label: t('frontDesk.rules.overdue14') },
                  ]}
                />
                <span className="ultm8-field__hint u8n-dd-field__hint">{t('frontDesk.rules.overdueHint')}</span>
              </div>
            </SettingsGroup>

            <SettingsGroup icon="desk" title={t('frontDesk.rules.deskHeading')}>
              <Switch
                id="rules-several-classes"
                label={t('frontDesk.rules.severalClasses')}
                description={t('frontDesk.rules.severalClassesHint')}
                checked={form.severalClasses}
                onChange={(on) => set('severalClasses', on)}
              />
              {/* Backlog §3.5: on by default, as the welcome card always was. */}
              <Switch
                id="rules-belt-progress"
                label={t('frontDesk.rules.showBeltProgress')}
                description={t('frontDesk.rules.showBeltProgressHint')}
                checked={form.showBeltProgress ?? true}
                onChange={(on) => set('showBeltProgress', on)}
              />
              <div className="u8n-dd-field u8me-setting-choice">
                <NewLookSelect
                  id="rules-code-digits"
                  label={t('frontDesk.rules.codeDigits')}
                  value={String(form.codeDigits)}
                  onChange={(v) => set('codeDigits', v === '6' ? 6 : 4)}
                  options={[
                    { value: '4', label: t('schools.form.checkInCodeDigits4') },
                    { value: '6', label: t('schools.form.checkInCodeDigits6') },
                  ]}
                />
                <span className="ultm8-field__hint u8n-dd-field__hint">{t('frontDesk.rules.codeDigitsHint')}</span>
              </div>
            </SettingsGroup>

            <p className="u8me-note">{t('frontDesk.rules.everyWayIn')}</p>
            <div className="u8me-actions">
              <Button type="submit" loading={save.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : null}
      </NewLookPage>
    </>
  );
}

/** The design's small outline pictures for each group's heading. */
const GROUP_ICONS: Record<'when' | 'who' | 'desk', React.ReactNode> = {
  when: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  who: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
    </>
  ),
  desk: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3z" />
    </>
  ),
};

/** One group of settings: a white card under a small uppercase heading. */
function SettingsGroup({ icon, title, children }: { icon: keyof typeof GROUP_ICONS; title: string; children: React.ReactNode }) {
  const id = `rules-group-${icon}`;
  return (
    <section className="u8me-card" aria-labelledby={id}>
      <h2 className="u8me-card__heading" id={id}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {GROUP_ICONS[icon]}
        </svg>
        {title}
      </h2>
      {children}
    </section>
  );
}
