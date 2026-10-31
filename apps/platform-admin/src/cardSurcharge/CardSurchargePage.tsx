import React, { useState } from 'react';
import { Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAddCardSurchargeCountry, useCardSurchargeCountries, useRemoveCardSurchargeCountry, type CardSurchargeCountry } from './cardSurchargeQueries';

/** Country name in English, falling back to the code. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Decision 406: the countries where a School may add a card surcharge to its
 * members' card payments. The list starts empty, and a country is added only
 * after legal review: consumer card surcharges are illegal in the UK and the
 * EU. Changing it is Billing & Payments Ops or Full Admin only server-side (a
 * Support admin sees that refusal here), and every change is audit-logged.
 */
export function CardSurchargePage() {
  const { data, isLoading, error } = useCardSurchargeCountries();
  const add = useAddCardSurchargeCountry();
  const remove = useRemoveCardSurchargeCountry();
  const [code, setCode] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const items = data?.items ?? [];
  const valid = /^[A-Za-z]{2}$/.test(code.trim());
  const actionError = add.error ?? remove.error;

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !reviewed) return;
    add.mutate(code.trim().toUpperCase(), {
      onSuccess: () => {
        setCode('');
        setReviewed(false);
      },
    });
  }

  return (
    <>
      <PageHeader
        title="Card surcharge countries"
        subtitle="Schools in these countries may add a card surcharge (up to 3%) to members' card payments. Everywhere else it is off. Billing & Payments Ops and Full Admins only; every change is recorded in the audit log."
      />
      {error ? <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load the countries.'} /> : null}
      {actionError ? <ErrorBanner message={actionError instanceof ApiError ? actionError.message : 'Could not change the list.'} /> : null}

      <Card>
        <form onSubmit={handleAdd}>
          <h3 style={{ marginTop: 0 }}>Add a country</h3>
          <p style={{ marginTop: 0 }}>
            Only add a country after legal review. Consumer card surcharges are illegal in the UK and the EU.
          </p>
          <Field label="Country code" htmlFor="surcharge-country" hint="Two letters (ISO 3166-1), e.g. US.">
            <TextField id="surcharge-country" value={code} maxLength={2} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {valid ? <p style={{ margin: '0 0 8px' }}>{countryName(code.trim().toUpperCase())}</p> : null}
          <Checkbox
            id="surcharge-reviewed"
            label="Legal review confirmed card surcharges are allowed in this country"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          <div style={{ marginTop: 12 }}>
            <Button type="submit" loading={add.isPending} disabled={!valid || !reviewed}>
              Add country
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No countries yet" description="Card surcharges are off for every School until a country is added here." />
        ) : (
          <Table<CardSurchargeCountry & { id: string }>
            rows={items.map((c) => ({ ...c, id: c.countryCode }))}
            columns={[
              { key: 'countryCode', header: 'Code', render: (c) => c.countryCode },
              { key: 'name', header: 'Country', render: (c) => countryName(c.countryCode) },
              { key: 'createdAt', header: 'Added', render: (c) => new Date(c.createdAt).toLocaleString() },
              {
                key: 'actions',
                header: '',
                render: (c) => (
                  <Button variant="secondary" onClick={() => setRemoving(c.countryCode)}>
                    Remove
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {removing ? (
        <Modal title={`Remove ${countryName(removing)}?`} onClose={() => setRemoving(null)}>
          <p style={{ marginTop: 0 }}>
            Schools there stop adding a card surcharge to new payments straight away, and members' running subscriptions there stop paying it from their next renewal. The Schools' saved % is kept, but isn't charged or shown unless the country is added again; adding it back applies to new subscriptions only.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Back
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(removing, { onSuccess: () => setRemoving(null) })}>
              Remove
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
