import { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useSchoolTrial, type SchoolResponse } from './schoolQueries';

const DAY_MS = 86_400_000;

/**
 * Backlog 3.14 (Decision 318 item 5): a free trial of ULTM8 for this School,
 * managed only here, never by the School owner, with no card. When it ends
 * without an active platform subscription the School's portal is read-only
 * until it subscribes; nothing is deleted. Starting and extending are Full
 * Admin only server-side; a lower tier sees that refusal as an error here.
 */
export function SchoolTrialCard({ school }: { school: SchoolResponse }) {
  const trial = useSchoolTrial(school.id);
  const [days, setDays] = useState('');
  const ends = school.platformTrialEndsAt ? new Date(school.platformTrialEndsAt) : null;
  const subscribed = school.platformSubscriptionStatus === 'ACTIVE' || school.platformSubscriptionStatus === 'PAST_DUE';
  const daysLeft = ends ? Math.ceil((ends.getTime() - Date.now()) / DAY_MS) : null;
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;
  const send = (action: 'start' | 'extend') => trial.mutate({ action, days: n }, { onSuccess: () => setDays('') });

  return (
    <Card>
      <h3 style={{ marginTop: 0 }}>Free trial of ULTM8</h3>
      {subscribed ? (
        <p>This School has a platform subscription ({school.platformSubscriptionStatus}), so it needs no trial.</p>
      ) : !ends ? (
        <p>No trial. Without a trial or a subscription, the School works as today.</p>
      ) : daysLeft !== null && daysLeft > 0 ? (
        <p>
          <Badge variant="accent">Trial</Badge> Ends {ends.toLocaleString()} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left.
        </p>
      ) : (
        <p>
          <Badge variant="danger">Trial ended</Badge> Ended {ends.toLocaleString()}. The portal is read-only until the School subscribes.
        </p>
      )}
      {trial.error ? <ErrorBanner message={trial.error instanceof ApiError ? trial.error.message : 'Could not change the trial.'} /> : null}
      {subscribed ? null : (
        <>
          <Field label={ends ? 'Days to add' : 'Trial length (days)'} htmlFor="trial-days" hint="1 to 365. No card is taken. Recorded in the audit log.">
            <TextField id="trial-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ends ? (
              <>
                <Button loading={trial.isPending} disabled={!valid} onClick={() => send('extend')}>
                  Extend trial
                </Button>
                <Button variant="secondary" disabled={!valid || trial.isPending} onClick={() => send('start')}>
                  Start a new trial from today
                </Button>
              </>
            ) : (
              <Button loading={trial.isPending} disabled={!valid} onClick={() => send('start')}>
                Start trial
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
