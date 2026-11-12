import React, { useLayoutEffect, useRef, useState } from 'react';

export interface RosterColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

/**
 * The class page's Bookings and Waitlist lists in the new look (DESIGN.md →
 * "Phone layout"; the same approach as the Cancellations list): a table while
 * it fits its card, a card per row once it doesn't, measured on the card
 * itself so the side menu and the language are allowed for. Same columns,
 * data and buttons either way; in a row card each column's name sits in front
 * of its value. Nothing scrolls sideways.
 */
export function RosterTable<T extends { id: string }>({ columns, rows, testId }: { columns: RosterColumn<T>[]; rows: T[]; testId?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState(false);
  // How wide the table needed to be when it last stopped fitting.
  const neededRef = useRef(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
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
  }, [cards]);

  return (
    <div ref={boxRef} className="u8cd-list" data-layout={cards ? 'cards' : 'table'} data-testid={testId}>
      <table className="u8cd-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key} className={`u8cd-col-${col.key}`}>
                  <span className="u8cd-cell-label" aria-hidden="true">
                    {col.header}
                  </span>
                  <span className="u8cd-cell-value">{col.render(row)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
