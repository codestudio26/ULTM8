import React, { useEffect, useState } from 'react';
import { TextField } from '@ultm8/ui';

/**
 * An amount typed in normal units ("12.50") and handed back in hundredths
 * (1250), the way every money column is stored (see `formatMoney`). Before
 * this, the Class form's cancellation charge was typed straight in hundredths,
 * so "10" meant 0.10 (Classes review C10); the belt fee field already did this
 * conversion by hand (BeltEditorModal).
 *
 * `value`/`onChange` are in hundredths; `null` is an empty field. Text that
 * isn't an amount (letters, a minus sign, more than two decimals) reports
 * `valid: false`, so the form can say so rather than round silently.
 */
export function MoneyField({
  id,
  value,
  onChange,
  currency,
  disabled,
  'aria-describedby': describedBy,
}: {
  id?: string;
  value: number | null;
  onChange: (minorUnits: number | null, valid: boolean) => void;
  /** Shown after the box, e.g. "GBP". Optional: a charge can be paid in more
   * than one currency. */
  currency?: string | null;
  disabled?: boolean;
  'aria-describedby'?: string;
}) {
  const [text, setText] = useState(() => toText(value));

  // Follow an outside reset (a different row opened) without fighting typing.
  useEffect(() => {
    if (parseMoney(text).minorUnits !== value) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <TextField
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseMoney(e.target.value);
          onChange(parsed.minorUnits, parsed.valid);
        }}
      />
      {currency ? <span className="ultm8-field__hint">{currency.toUpperCase()}</span> : null}
    </div>
  );
}

function toText(minorUnits: number | null): string {
  if (minorUnits === null) return '';
  return minorUnits % 100 === 0 ? String(minorUnits / 100) : (minorUnits / 100).toFixed(2);
}

/** "12.5" → 1250; "" → null (valid); "abc", "-1", "1.234" → invalid. A comma
 * decimal separator ("12,50") is accepted too. */
export function parseMoney(text: string): { minorUnits: number | null; valid: boolean } {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { minorUnits: null, valid: true };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { minorUnits: null, valid: false };
  return { minorUnits: Math.round(Number(trimmed) * 100), valid: true };
}
