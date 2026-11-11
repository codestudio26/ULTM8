import React, { useLayoutEffect, useRef, useState } from 'react';
import './studentsSection.css';

/**
 * Pieces for the Students section's other pages in the new look (Decision
 * 453): Sign-ups, Attendance, Growth, Import and Rosters. The approved design
 * draws none of them, so they keep their content and take the new header,
 * cards, tags and pill buttons from the Billing pages' pieces
 * (`billing/BillingLook`, as Cancellations does), plus the two pieces below.
 * Styles in studentsSection.css, scoped to `[data-look='redesign']`.
 */

export interface FitTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** The main cell: in the card layout it leads, larger, with no label. */
  main?: boolean;
}

/**
 * A table that becomes a list of cards when it doesn't fit its card (a phone,
 * a tablet or a narrow window), so nothing scrolls sideways (brief, 11 Nov
 * 2026; as Cancellations does). In the card layout each cell is a line led by
 * its column's name, the main cell first.
 */
export function FitTable<T extends { id: string }>({ columns, rows, testId }: { columns: FitTableColumn<T>[]; rows: T[]; testId?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState(false);
  // How wide the table needed to be when it last stopped fitting.
  const neededRef = useRef(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const check = () => {
      if (!cards) {
        const table = box.querySelector('table');
        if (table && table.scrollWidth > box.clientWidth + 1) {
          neededRef.current = table.scrollWidth;
          setCards(true);
        }
      } else if (box.clientWidth >= neededRef.current) {
        setCards(false);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    const table = box.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [cards, rows.length]);

  return (
    <div ref={boxRef} className="u8st-fit" data-layout={cards ? 'cards' : 'table'} data-testid={testId}>
      <table className="ultm8-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key} className={col.main ? 'u8st-fit__main' : undefined}>
                  {!col.main && col.header ? (
                    <span className="u8st-fit__label" aria-hidden="true">
                      {col.header}
                    </span>
                  ) : null}
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One number in a stat row (DESIGN.md → "Stat rows"), in the Billing pages'
 * stat look. `testId` stays on the number, as before. */
export function SectionStat({ label, value, note, testId }: { label: string; value: string; note?: string; testId: string }) {
  return (
    <div className="u8b-stat">
      <span className="u8b-stat__label">{label}</span>
      <span className="u8b-stat__num" data-testid={testId}>
        {value}
      </span>
      {note ? <span className="u8b-stat__hint">{note}</span> : null}
    </div>
  );
}
