import React from 'react';
import { ClassAvatar } from './ClassAvatar';

export interface ClassPanelAction {
  label: string;
  onClick: () => void;
}

/**
 * The right-hand panel of the Schedule pages: the selected class. It never
 * repeats the selected row (DESIGN.md "nothing shown twice"; the owner's
 * answer "B" on #545, 11 Nov 2026): the 64px avatar and the name head the
 * panel, as on the Students and Team panels, then only the facts the row
 * doesn't show, and the row's own actions as buttons straight under the
 * content (DESIGN.md → "Side panel buttons sit under the content"). On a
 * phone NewLookPage puts it below the list.
 */
export function ClassPanel({
  title,
  bannerUrl,
  colourKey,
  cancelled,
  facts = [],
  actions,
}: {
  title: string;
  bannerUrl?: string | null;
  colourKey: string;
  cancelled?: boolean;
  /** Only facts the selected row doesn't already show. */
  facts?: Array<{ label: string; value: React.ReactNode }>;
  actions: ClassPanelAction[];
}) {
  return (
    <div className="u8s-panel">
      <div className="u8s-panel__who">
        <ClassAvatar title={title} bannerUrl={bannerUrl} colourKey={colourKey} large />
        <div className="u8s-panel__name-block">
          <p className={'u8s-panel__name' + (cancelled ? ' u8s-panel__name--cancelled' : '')}>{title}</p>
        </div>
      </div>
      {facts.length > 0 ? (
        <dl className="u8s-panel__facts">
          {facts.map((f) => (
            <div key={f.label} className="u8s-panel__fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {actions.length > 0 ? (
        <div className="u8s-panel__actions">
          {actions.map((a) => (
            <button key={a.label} type="button" className="u8s-pill" onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
