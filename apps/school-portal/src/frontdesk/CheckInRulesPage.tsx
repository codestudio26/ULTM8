import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { Button, Card, ErrorBanner, Field, PageHeader, SelectField, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { apiClient } from '../api';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { errorText } from './frontDeskQueries';

type CheckInRules = components['schemas']['CheckInRulesDto'];
type Form = Omit<CheckInRules, 'opensMinutesBeforeStart' | 'closesMinutesAfterStart'> & {
  opensMinutesBeforeStart: string;
  closes: 'end' | 'after';
  closesMinutesAfterStart: string;
};

export function useCheckInRules(schoolId: string | null) {
  return useQuery({
    queryKey: ['check-in-rules', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/check-in-rules', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

function toForm(r: CheckInRules): Form {
  return {
    ...r,
    opensMinutesBeforeStart: String(r.opensMinutesBeforeStart),
    closes: r.closesMinutesAfterStart === null ? 'end' : 'after',
    closesMinutesAfterStart: r.closesMinutesAfterStart === null ? '15' : String(r.closesMinutesAfterStart),
  };
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
    save.mutate({
      opensMinutesBeforeStart: Number(form.opensMinutesBeforeStart),
      closesMinutesAfterStart: form.closes === 'end' ? null : Number(form.closesMinutesAfterStart),
      requireWaiver: form.requireWaiver,
      otherBranches: form.otherBranches,
      visitors: form.visitors,
      severalClasses: form.severalClasses,
      frozenMembers: form.frozenMembers ?? false,
      codeDigits: form.codeDigits,
    });
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

            <h2 className="fd-eyebrow">{t('frontDesk.rules.deskHeading')}</h2>
            <Switch
              id="rules-several-classes"
              label={t('frontDesk.rules.severalClasses')}
              description={t('frontDesk.rules.severalClassesHint')}
              checked={form.severalClasses}
              onChange={(on) => set('severalClasses', on)}
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
