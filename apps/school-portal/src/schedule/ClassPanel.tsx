import React from 'react';
import { ClassAvatar } from './ClassAvatar';

export interface ClassPanelAction {
  label: string;
  onClick: () => void;
}

/**
 * The right-hand panel of the Schedule pages: the selected class (Decision
 * 455, Q2). Only what the page already loads: the 64px avatar and the name,
 * a status tag, the facts (time, branch, coach, seats), the tags, and the
 * row's own ⋮ actions as buttons straight under the content (DESIGN.md →
 * "Side panel buttons sit under the content"). On a phone NewLookPage puts
 * it below the list.
 */
export function ClassPanel({
  title,
  bannerUrl,
  colourKey,
  cancelled,
  status,
  facts,
  tags,
  actions,
}: {
  title: string;
  bannerUrl?: string | null;
  colourKey: string;
  cancelled?: boolean;
  /** Tags such as Cancelled or Archived, shown under the name. */
  status?: React.ReactNode;
  facts: Array<{ label: string; value: React.ReactNode }>;
  tags?: React.ReactNode;
  actions: ClassPanelAction[];
}) {
  return (
    <div className="u8s-panel">
      <div className="u8s-panel__who">
        <ClassAvatar title={title} bannerUrl={bannerUrl} colourKey={colourKey} large />
        <div className="u8s-panel__name-block">
          <p className={'u8s-panel__name' + (cancelled ? ' u8s-panel__name--cancelled' : '')}>{title}</p>
          {status ? <div className="u8s-tags">{status}</div> : null}
        </div>
      </div>
      <dl className="u8s-panel__facts">
        {facts.map((f) => (
          <div key={f.label} className="u8s-panel__fact">
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {tags ? <div className="u8s-panel__tags">{tags}</div> : null}
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
