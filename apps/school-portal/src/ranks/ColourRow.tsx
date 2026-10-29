import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useBeltColours, useSaveBeltColours } from './rankQueries';
import { MAX_SAVED_COLOURS, PRESET_COLOURS, hexToHsv, hsvToHex, hsvToRgb, isColourCode, normalColour, sameColour, type Hsv } from './colour';

const WHEEL = 168;

/**
 * One colour row of the belt editor (DESIGN.md → "Colour choices"; backlog
 * 3.18): the preset circles, then the School's saved colours, then a dashed
 * "+" that opens our own colour panel (wheel, Brightness, preview, colour
 * code). "Save colour" applies the colour and adds it to the saved colours,
 * which every colour row and every style at the School share. Deleting a
 * saved colour never changes a belt already using it.
 *
 * `optional` rows (secondary and tag colour) also offer "None", which sets ''.
 */
export function ColourRow({
  id,
  label,
  hint,
  value,
  onChange,
  schoolId,
  optional = false,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (colour: string) => void;
  schoolId: string;
  optional?: boolean;
}) {
  const t = useT();
  const saved = useBeltColours(schoolId).data?.colours ?? [];
  const saveList = useSaveBeltColours(schoolId);
  const [panel, setPanel] = useState<{ editing: string | null; start: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const current = value.trim();
  const isPreset = PRESET_COLOURS.some((c) => sameColour(c, current));
  const isSaved = saved.some((c) => sameColour(c, current));
  const custom = current !== '' && !isPreset;

  async function storeList(next: string[]) {
    setMessage(null);
    try {
      await saveList.mutateAsync(next);
      return true;
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : t('ranks.editor.savedColoursFailed'));
      return false;
    }
  }

  async function addToSaved(colour: string, replacing: string | null) {
    const code = normalColour(colour);
    let next: string[];
    if (replacing) {
      next = saved.map((c) => (sameColour(c, replacing) ? code : c));
    } else {
      if (saved.some((c) => sameColour(c, code))) return;
      if (saved.length >= MAX_SAVED_COLOURS) {
        setMessage(t('ranks.editor.savedColoursFull', { count: MAX_SAVED_COLOURS }));
        return;
      }
      next = [...saved, code];
    }
    await storeList(next.filter((c, i) => next.findIndex((d) => sameColour(c, d)) === i));
  }

  const circle = (colour: string, kind: 'preset' | 'saved') => {
    const on = sameColour(colour, current);
    return (
      <button
        key={`${kind}-${colour}`}
        type="button"
        className={`ultm8-swatch${on ? ' ultm8-swatch--on' : ''}`}
        style={{ background: colour }}
        aria-label={kind === 'saved' ? t('ranks.editor.savedColourAria', { code: normalColour(colour) }) : t('ranks.editor.colourAria', { code: normalColour(colour) })}
        aria-pressed={on}
        title={normalColour(colour)}
        onClick={() => onChange(normalColour(colour))}
      />
    );
  };

  return (
    <fieldset className="ultm8-colour-row" id={id}>
      <legend className="ultm8-field__label">{label}</legend>
      {hint ? <p className="ultm8-field__hint" style={{ margin: '0 0 6px' }}>{hint}</p> : null}
      <div className="ultm8-swatches">
        {optional ? (
          <button
            type="button"
            className={`ultm8-swatch ultm8-swatch--none${current === '' ? ' ultm8-swatch--on' : ''}`}
            aria-label={t('ranks.editor.noColour')}
            aria-pressed={current === ''}
            title={t('ranks.editor.noColour')}
            onClick={() => onChange('')}
          />
        ) : null}
        {PRESET_COLOURS.map((c) => circle(c, 'preset'))}
        {saved.filter((c) => !PRESET_COLOURS.some((p) => sameColour(p, c))).map((c) => circle(c, 'saved'))}
        <button
          type="button"
          className="ultm8-swatch ultm8-swatch--add"
          aria-label={t('ranks.editor.addColour')}
          aria-expanded={panel !== null}
          title={t('ranks.editor.addColour')}
          onClick={() => setPanel({ editing: null, start: isColourCode(current) ? current : '#2A9D8F' })}
        >
          +
        </button>
      </div>
      {custom ? (
        <div className="ultm8-colour-row__custom">
          <span className="ultm8-swatch ultm8-swatch--small" style={{ background: isColourCode(current) ? current : 'transparent' }} aria-hidden="true" />
          <span>
            {t('ranks.editor.customColour', { code: normalColour(current) })}
            {isSaved ? null : ` ${t('ranks.editor.notSaved')}`}
          </span>
          {isSaved ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setPanel({ editing: normalColour(current), start: current })}>
                {t('ranks.editor.editColour')}
              </Button>
              <Button type="button" variant="secondary" disabled={saveList.isPending} onClick={() => void storeList(saved.filter((c) => !sameColour(c, current)))}>
                {t('ranks.editor.deleteColour')}
              </Button>
            </>
          ) : isColourCode(current) ? (
            <Button
              type="button"
              variant="secondary"
              aria-label={t('ranks.editor.saveSavedColourAria', { code: normalColour(current) })}
              disabled={saveList.isPending}
              onClick={() => void addToSaved(current, null)}
            >
              {t('ranks.editor.saveSavedColour')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {panel ? (
        <ColourPanel
          key={`${panel.editing ?? 'new'}-${panel.start}`}
          start={panel.start}
          busy={saveList.isPending}
          onCancel={() => setPanel(null)}
          onSave={async (code) => {
            onChange(code);
            await addToSaved(code, panel.editing);
            setPanel(null);
          }}
        />
      ) : null}
      {message ? (
        <p className="ultm8-field__error" role="alert">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The colour panel: a wheel (the centre is white, the edge full colour), a
 * Brightness slider, a preview circle and a colour code box. It stays open
 * until Save colour or Cancel; picking, dragging or typing never closes it. */
function ColourPanel({ start, busy, onSave, onCancel }: { start: string; busy: boolean; onSave: (code: string) => void; onCancel: () => void }) {
  const t = useT();
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(start));
  const [code, setCode] = useState(normalColour(start));
  const canvas = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const ids = useId();
  const valid = isColourCode(code);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(WHEEL, WHEEL);
    const r = WHEEL / 2;
    for (let y = 0; y < WHEEL; y++) {
      for (let x = 0; x < WHEEL; x++) {
        const dx = x - r + 0.5;
        const dy = y - r + 0.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const [cr, cg, cb] = hsvToRgb({ h, s: d / r, v: hsv.v });
        const i = (y * WHEEL + x) * 4;
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv.v]);

  const choose = (next: Hsv) => {
    setHsv(next);
    setCode(hsvToHex(next));
  };

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const r = box.width / 2;
    const dx = e.clientX - box.left - r;
    const dy = e.clientY - box.top - r;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    choose({ h, s: Math.min(1, Math.sqrt(dx * dx + dy * dy) / r), v: hsv.v });
  };

  const angle = (hsv.h * Math.PI) / 180;
  const markerX = 50 + Math.cos(angle) * hsv.s * 50;
  const markerY = 50 + Math.sin(angle) * hsv.s * 50;

  return (
    <div className="ultm8-colour-panel">
      <div className="ultm8-colour-panel__wheel">
        <canvas
          ref={canvas}
          width={WHEEL}
          height={WHEEL}
          role="img"
          aria-label={t('ranks.editor.colourWheel')}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => (dragging.current ? pick(e) : undefined)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        />
        <span className="ultm8-colour-panel__marker" style={{ left: `${markerX}%`, top: `${markerY}%` }} aria-hidden="true" />
      </div>
      <div className="ultm8-colour-panel__side">
        <span className="ultm8-swatch ultm8-swatch--preview" style={{ background: valid ? normalColour(code) : 'transparent' }} aria-hidden="true" />
        <label className="ultm8-field__label" htmlFor={`${ids}-brightness`}>
          {t('ranks.editor.brightness')}
        </label>
        <input
          id={`${ids}-brightness`}
          type="range"
          min={0}
          max={100}
          value={Math.round(hsv.v * 100)}
          onChange={(e) => choose({ ...hsv, v: Number(e.target.value) / 100 })}
        />
        <label className="ultm8-field__label" htmlFor={`${ids}-code`}>
          {t('ranks.editor.colourCode')}
        </label>
        <TextField
          id={`${ids}-code`}
          value={code}
          maxLength={7}
          placeholder="#2A9D8F"
          onChange={(e) => {
            setCode(e.target.value);
            if (isColourCode(e.target.value)) setHsv(hexToHsv(e.target.value));
          }}
        />
        {!valid ? <p className="ultm8-field__error">{t('ranks.editor.colourCodeInvalid')}</p> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" disabled={!valid || busy} onClick={() => onSave(normalColour(code))}>
            {t('ranks.editor.saveColour')}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
