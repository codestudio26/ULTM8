import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { Button, Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { apiClient } from '../api';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { errorText } from './frontDeskQueries';
import { checkInRulesBody, toCheckInRulesForm as toForm, type CheckInRules, type CheckInRulesForm as Form } from './checkInRulesForm';

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

  return (
    <>
      <PageHeader
        title={t('frontDesk.rules.title')}
        subtitle={t('frontDesk.rules.subtitle')}
        actions={
          <Link to="/check-in" className="fd-pill fd-pill--line">
            {t('frontDesk.rules.back')}
          </Link>
        }
      />
      {rules.isLoading ? (
        <Spinner />
      ) : rules.error ? (
        <ErrorBanner message={errorText(rules.error, t('frontDesk.rules.loadFailed'))} />
      ) : form ? (
        <Card>
          <form onSubmit={handleSubmit} data-testid="check-in-rules">
            {saved ? <SuccessBanner message={t('frontDesk.rules.saved')} /> : null}
            {save.error ? <ErrorBanner message={errorText(save.error, t('frontDesk.rules.saveFailed'))} /> : null}
            <h2 className="fd-eyebrow">{t('frontDesk.rules.whenHeading')}</h2>
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
            <Field label={t('frontDesk.rules.closes')} htmlFor="rules-closes" hint={t('frontDesk.rules.closesHint')}>
              <SelectField
                id="rules-closes"
                value={form.closes}
                onChange={(e) => set('closes', e.target.value === 'after' ? 'after' : 'end')}
                options={[
                  { value: 'end', label: t('frontDesk.rules.closesAtEnd') },
                  { value: 'after', label: t('frontDesk.rules.closesAfterStart') },
                ]}
              />
            </Field>
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

            <h2 className="fd-eyebrow">{t('frontDesk.rules.whoHeading')}</h2>
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
            <Field label={t('frontDesk.rules.overdue')} htmlFor="rules-overdue" hint={t('frontDesk.rules.overdueHint')}>
              <SelectField
                id="rules-overdue"
                value={form.overdue}
                onChange={(e) => set('overdue', e.target.value === '7' ? '7' : e.target.value === '14' ? '14' : 'no')}
                options={[
                  { value: 'no', label: t('frontDesk.rules.overdueNo') },
                  { value: '7', label: t('frontDesk.rules.overdue7') },
                  { value: '14', label: t('frontDesk.rules.overdue14') },
                ]}
              />
            </Field>

            <h2 className="fd-eyebrow">{t('frontDesk.rules.deskHeading')}</h2>
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
            <Field label={t('frontDesk.rules.codeDigits')} htmlFor="rules-code-digits" hint={t('frontDesk.rules.codeDigitsHint')}>
              <SelectField
                id="rules-code-digits"
                value={String(form.codeDigits)}
                onChange={(e) => set('codeDigits', e.target.value === '6' ? 6 : 4)}
                options={[
                  { value: '4', label: t('schools.form.checkInCodeDigits4') },
                  { value: '6', label: t('schools.form.checkInCodeDigits6') },
                ]}
              />
            </Field>
            <p style={{ fontSize: 13, opacity: 0.75 }}>{t('frontDesk.rules.everyWayIn')}</p>
            <Button type="submit" loading={save.isPending}>
              {t('common.save')}
            </Button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
