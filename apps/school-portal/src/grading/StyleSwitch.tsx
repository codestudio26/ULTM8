import React from 'react';
import { useT } from '../i18n/I18nProvider';
import './styleSwitch.css';

/**
 * The style switch (DESIGN.md → "Style switch: one look everywhere";
 * Decision 462 items 10 and 11): one button per style on a light grey track,
 * the chosen one white and raised. It replaces the style drop-down on the
 * Grading pages. With many styles the track wraps onto more lines inside its
 * card, so it never pushes the page sideways on a phone.
 */
export function StyleSwitch({
  styles,
  value,
  onChange,
  label,
}: {
  styles: Array<{ id: string; name: string }>;
  value: string | null;
  onChange: (id: string) => void;
  /** The group's accessible name; "Style" when left out. */
  label?: string;
}) {
  const t = useT();
  return (
    <div role="group" aria-label={label ?? t('grading.board.styleLabel')} className="u8ss">
      {styles.map((d) => (
        <button
          key={d.id}
          type="button"
          className="u8ss__btn"
          aria-pressed={d.id === value}
          onClick={() => {
            if (d.id !== value) onChange(d.id);
          }}
        >
          {d.name}
        </button>
      ))}
    </div>
  );
}
