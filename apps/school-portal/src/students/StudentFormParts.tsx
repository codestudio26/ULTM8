import React, { useId } from 'react';

/**
 * One chapter of a form in pattern "F" (DESIGN.md → "Form pattern F"): the
 * number, title and a one-line explanation on the left, the fields on the
 * right, two to a row. Once its required fields are filled the number turns
 * green and a "Done" tag follows the title (DESIGN.md → "Add student:
 * nothing shown twice"). The fields are a group named by the title.
 */
export function Chapter({
  number,
  title,
  description,
  done = false,
  doneLabel,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  done?: boolean;
  doneLabel?: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section className={'ultm8-chapter' + (done ? ' ultm8-chapter--done' : '')}>
      <div>
        <div className="ultm8-chapter__number" aria-hidden="true">
          {String(number).padStart(2, '0')}
        </div>
        <h2 className="ultm8-chapter__title">
          <span id={titleId}>{title}</span>
          {done && doneLabel ? <span className="u8f-done">{doneLabel}</span> : null}
        </h2>
        {description ? <p className="ultm8-chapter__desc">{description}</p> : null}
      </div>
      <div className="ultm8-chapter__fields" role="group" aria-labelledby={titleId}>
        {children}
      </div>
    </section>
  );
}

/** Up to two initials for the preview card's circle (DESIGN.md → "Avatars"). */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
