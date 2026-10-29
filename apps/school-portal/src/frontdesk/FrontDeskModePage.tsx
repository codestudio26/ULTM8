import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '@ultm8/ui';
import { useAuth, useGradingSchoolId } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';
import { hasBackend } from './frontDeskFeatures';
import { errorText } from './frontDeskQueries';
import { saveKioskToken, useKioskFindMe, useKioskSignUp, useMyKioskCode, useStartKiosk, type KioskSignUpInput as SignUpInput } from './kioskSession';
import { useHeardFromChoices } from './heardFrom';
import { SoonTag } from './parts';
import './frontDesk.css';

const EMPTY_SIGN_UP: SignUpInput = {
  kind: 'MEMBER',
  firstName: '',
  surname: '',
  dateOfBirth: '',
  gender: '',
  phone: '',
  email: '',
  heardFrom: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
};

/**
 * Starting front-desk mode (DESIGN.md → "Check-in and front-desk mode";
 * Decisions 317, 320, 351, 380). Staff pick the Branch the device is at and
 * see their own code for leaving it. Start gives the device a front-desk
 * session, signs the staff member out of it and opens the tablet
 * (KioskApp): from then on the device holds no staff login.
 */
export function FrontDeskModePage() {
  const t = useT();
  const navigate = useNavigate();
  const { claims } = useAuth();
  const schoolId = useGradingSchoolId();
  const branchQuery = useBranches(schoolId);
  const myGrants = (claims?.grants ?? []).filter((g) => g.schoolId === schoolId);
  const isOwner = myGrants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER');
  const staffBranchIds = myGrants.filter((g) => g.role === 'BRANCH_STAFF').map((g) => g.branchId ?? null);
  // The owner, or Branch Staff for their own Branch (handover F1).
  const canStartAt = (id: string | null) => isOwner || staffBranchIds.some((b) => b === null || b === id);
  const allOpen = (branchQuery.data?.items ?? []).filter((b) => !b.archivedAt);
  const branches = allOpen.filter((b) => canStartAt(b.id));
  // A School with no Branches runs front-desk mode for the whole School (CI4).
  const wholeSchool = branchQuery.isSuccess && allOpen.length === 0;
  const allowed = wholeSchool ? canStartAt(null) : branches.length > 0;
  const [branchId, setBranchId] = useState<string | null>(null);
  const myCode = useMyKioskCode(schoolId);
  const startKiosk = useStartKiosk(schoolId);
  const [error, setError] = useState<string | null>(null);

  if (!schoolId) return null;

  function start() {
    setError(null);
    startKiosk.mutate(wholeSchool ? null : branchId, {
      onSuccess: (r) => {
        saveKioskToken(r.sessionToken);
        // The tablet signs the staff member out as it opens (KioskApp).
        navigate('/front-desk/kiosk', { replace: true });
      },
      onError: (err) => setError(errorText(err, t('frontDesk.kiosk.startFailed'))),
    });
  }

  return (
    <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center', background: 'var(--surface-0)' }}>
      <div className="fd-dialog fd-dialog--small" style={{ textAlign: 'left', alignItems: 'stretch' }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400 }}>{t('frontDesk.kiosk.startTitle')}</h1>
        <p className="fd-class__meta" style={{ margin: 0 }}>
          {t('frontDesk.kiosk.startBody')}
        </p>
        <div role="radiogroup" aria-label={t('frontDesk.kiosk.branch')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {branchQuery.isPending ? <Spinner /> : null}
          {wholeSchool ? (
            <div className="fd-tick" style={{ background: 'var(--surface-1)', boxShadow: 'inset 0 0 0 2px #9fd3b2' }}>
              <span className="fd-tick__box" aria-hidden="true">
                ●
              </span>
              <span className="fd-tick__name">{t('frontDesk.kiosk.wholeSchool')}</span>
            </div>
          ) : null}
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={b.id === branchId}
              className="fd-tick"
              style={{ background: b.id === branchId ? 'var(--surface-1)' : undefined, boxShadow: b.id === branchId ? 'inset 0 0 0 2px #9fd3b2' : undefined }}
              onClick={() => setBranchId(b.id)}
            >
              <span className="fd-tick__box" aria-hidden="true">
                {b.id === branchId ? '●' : ''}
              </span>
              <span className="fd-tick__name">{b.name}</span>
            </button>
          ))}
        </div>
        {branchQuery.isSuccess && !allowed ? (
          <p className="fd-msg fd-msg--bad" style={{ margin: 0 }}>
            {t('frontDesk.kiosk.cantStart')}
          </p>
        ) : (
          <p className="fd-class__meta" style={{ margin: 0 }}>
            {t('frontDesk.kiosk.startLocked')}
          </p>
        )}
        {myCode.data ? (
          <div className="fd-note" data-testid="fd-my-code">
            <span className="fd-note__dot" aria-hidden="true" style={{ background: '#9fd3b2' }} />
            <div>
              <div className="fd-note__title">{t('frontDesk.kiosk.yourCode', { code: myCode.data.code })}</div>
              <div className="fd-note__body">{t('frontDesk.kiosk.yourCodeHint')}</div>
            </div>
          </div>
        ) : null}
        {error ? (
          <p className="fd-msg fd-msg--bad" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <button type="button" className="fd-pill fd-pill--go" disabled={!allowed || (!branchId && !wholeSchool) || startKiosk.isPending} onClick={start}>
          {t('frontDesk.kiosk.start')}
        </button>
        <button type="button" className="fd-pill fd-pill--line" onClick={() => navigate('/check-in')}>
          {t('frontDesk.kiosk.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Sign-up in three steps (Decision 351: it waits for staff approval; a child
 * is signed up only by their Guardian). Sending waits for its backend. */
/**
 * Sign-up on the tablet (Decision 392, handover F5): it waits for staff to
 * approve it. Visitor is offered only when the School has set how long a
 * visit pass lasts (Decision 391). Name, date of birth and email are needed;
 * the rest may be left blank.
 */
export function SignUpScreen({
  onBack,
  onSent,
  onFind,
  visitorsOn = false,
  heardFromOptions = null,
}: {
  onBack: () => void;
  onSent: () => void;
  onFind: () => void;
  visitorsOn?: boolean;
  heardFromOptions?: string[] | null;
}) {
  const t = useT();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<SignUpInput>(EMPTY_SIGN_UP);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof SignUpInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ready = hasBackend('signUp');
  const send = useKioskSignUp();
  const choices = useHeardFromChoices(heardFromOptions);
  const stepDone = step === 1 ? !!(form.firstName.trim() && form.surname.trim() && form.dateOfBirth) : step === 2 ? /\S+@\S+\.\S+/.test(form.email.trim()) : true;
  const field = (key: keyof SignUpInput, label: string, type = 'text', required = false) => (
    <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {required ? `${label} *` : label}
      <input className="ultm8-input" type={type} value={form[key]} onChange={set(key)} required={required} style={{ minHeight: 52, fontSize: 16 }} />
    </label>
  );
  const steps = [t('frontDesk.signUp.step1'), t('frontDesk.signUp.step2'), t('frontDesk.signUp.step3')];
  return (
    <div className="fd-page">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="fd-steps">
          {steps.map((s, i) => (
            <span key={s} className={i + 1 === step ? 'on' : ''}>
              {i + 1} · {s}
            </span>
          ))}
        </div>
        <button type="button" className="fd-pill fd-pill--line" onClick={onBack}>
          {t('frontDesk.kiosk.backToCheckIn')}
        </button>
      </div>
      {step === 1 ? (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step1')}</h1>
          <div className="fd-switch" role="radiogroup" aria-label={t('frontDesk.signUp.as')} style={{ alignSelf: 'flex-start' }}>
            {(visitorsOn ? (['VISITOR', 'MEMBER'] as const) : (['MEMBER'] as const)).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={form.kind === k} aria-selected={form.kind === k} onClick={() => setForm((f) => ({ ...f, kind: k }))}>
                {k === 'VISITOR' ? t('frontDesk.signUp.visitor') : t('frontDesk.signUp.member')}
              </button>
            ))}
          </div>
          <div className="fd-grid2">
            {field('firstName', t('frontDesk.signUp.firstName'), 'text', true)}
            {field('surname', t('frontDesk.signUp.surname'), 'text', true)}
            {field('dateOfBirth', t('frontDesk.signUp.dateOfBirth'), 'date', true)}
            <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {t('frontDesk.signUp.gender')}
              <select className="ultm8-input" value={form.gender} onChange={set('gender')} style={{ minHeight: 52, fontSize: 16 }}>
                <option value="" />
                <option value="FEMALE">{t('frontDesk.signUp.female')}</option>
                <option value="MALE">{t('frontDesk.signUp.male')}</option>
              </select>
            </label>
          </div>
          <p className="fd-class__meta">
            {t('frontDesk.signUp.childNote')}{' '}
            <button type="button" onClick={onFind} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'var(--text-success)', textDecoration: 'underline', cursor: 'pointer' }}>
              {t('frontDesk.signUp.findMe')}
            </button>
          </p>
        </>
      ) : step === 2 ? (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step2')}</h1>
          <div className="fd-grid2">
            {field('phone', t('frontDesk.signUp.phone'), 'tel')}
            {field('email', t('frontDesk.signUp.email'), 'email', true)}
            <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {t('frontDesk.signUp.heardFrom')}
              <select className="ultm8-input" value={form.heardFrom} onChange={set('heardFrom')} style={{ minHeight: 52, fontSize: 16 }}>
                <option value="" />
                {choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      ) : (
        <>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.signUp.step3')}</h1>
          <div className="fd-grid3">
            {field('emergencyName', t('frontDesk.signUp.emergencyName'))}
            {field('emergencyPhone', t('frontDesk.signUp.emergencyPhone'), 'tel')}
            {field('emergencyRelationship', t('frontDesk.signUp.emergencyRelationship'))}
          </div>
          <div className="fd-note">
            <span className="fd-note__dot" aria-hidden="true" style={{ background: '#9fd3b2' }} />
            <div>
              <div className="fd-note__title">{t('frontDesk.signUp.approvalTitle')}</div>
              <div className="fd-note__body">{ready ? t('frontDesk.signUp.approvalBody') : t('frontDesk.signUp.soonBody')}</div>
            </div>
          </div>
          {error ? (
            <p className="fd-msg fd-msg--bad" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <button type="button" className="fd-pill fd-pill--line" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          {t('frontDesk.signUp.back')}
        </button>
        {step < 3 ? (
          <button type="button" className="fd-pill fd-pill--go" style={{ minWidth: 200 }} disabled={!stepDone} onClick={() => setStep((s) => s + 1)}>
            {t('frontDesk.signUp.next')}
          </button>
        ) : (
          <button
            type="button"
            className="fd-pill fd-pill--go"
            style={{ minWidth: 200 }}
            disabled={!ready || send.isPending}
            onClick={() => {
              setError(null);
              send.mutate(form, { onSuccess: onSent, onError: (err) => setError(errorText(err, t('frontDesk.signUp.failed'))) });
            }}
          >
            {t('frontDesk.signUp.send')} {ready ? null : <SoonTag />}
          </button>
        )}
      </div>
    </div>
  );
}

/** Find me (Decision 351): only ever says "you're already a member" and sends
 * the person to check in. It never shows or fills in stored details. */
export function FindMeScreen({ onBack, onSignUp }: { onBack: () => void; onSignUp: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [result, setResult] = useState<'member' | 'none' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = hasBackend('findMe');
  const find = useKioskFindMe();
  return (
    <div className="fd-kiosk" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 560, maxWidth: 'calc(100% - 32px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 400 }}>{t('frontDesk.findMe.title')}</h1>
        <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {t('frontDesk.findMe.name')}
          <input className="ultm8-input" value={name} onChange={(e) => setName(e.target.value)} style={{ minHeight: 52, fontSize: 16 }} />
        </label>
        <label className="fd-class__meta" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {t('frontDesk.signUp.dateOfBirth')}
          <input className="ultm8-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={{ minHeight: 52, fontSize: 16 }} />
        </label>
        {result === 'member' ? (
          <div className="fd-note" style={{ background: 'var(--fill-success)' }}>
            <div>
              <div className="fd-note__title">{t('frontDesk.findMe.memberTitle')}</div>
              <div className="fd-note__body" style={{ color: 'var(--text-success)' }}>
                {t('frontDesk.findMe.memberBody')}
              </div>
            </div>
          </div>
        ) : result === 'none' ? (
          <p className="fd-class__meta">{t('frontDesk.findMe.none')}</p>
        ) : error ? (
          <div className="fd-msg fd-msg--bad" aria-live="polite">
            {error}
          </div>
        ) : null}
        <p className="fd-class__meta">{t('frontDesk.findMe.privacy')}</p>
        <div className="fd-pair">
          <button type="button" className="fd-pill fd-pill--line" onClick={result === 'none' ? onSignUp : onBack}>
            {result === 'none' ? t('frontDesk.findMe.signUp') : t('frontDesk.kiosk.backToCheckIn')}
          </button>
          {result === 'member' ? (
            <button type="button" className="fd-pill fd-pill--go" onClick={onBack}>
              {t('frontDesk.findMe.goCheckIn')}
            </button>
          ) : (
            <button
              type="button"
              className="fd-pill fd-pill--go"
              disabled={!ready || !name.trim() || !dob || find.isPending}
              onClick={() => {
                setError(null);
                find.mutate(
                  { fullName: name.trim(), dateOfBirth: dob },
                  { onSuccess: (r) => setResult(r.alreadyMember ? 'member' : 'none'), onError: (err) => setError(errorText(err, t('frontDesk.findMe.failed'))) },
                );
              }}
            >
              {t('frontDesk.findMe.search')} {ready ? null : <SoonTag />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
