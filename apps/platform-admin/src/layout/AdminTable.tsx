import React from 'react';
import './adminLook.css';

export interface AdminTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  /** A column of buttons at the row's end: no heading, aligned to the end. */
  end?: boolean;
}

/**
 * The new look's list table for Platform Admin's pages (adminLook.css), the
 * same columns and rows the shared `Table` drew. When it doesn't fit its card
 * each row becomes a small card, each value labelled by its column heading,
 * so nothing scrolls the page sideways.
 */
export function AdminTable<T extends { id: string }>({ columns, rows }: { columns: AdminTableColumn<T>[]; rows: T[] }) {
  return (
    <div className="u8a-table">
      <table>
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
                <td key={col.key} data-label={col.header || undefined} className={col.end ? 'u8a-table__end' : undefined}>
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
