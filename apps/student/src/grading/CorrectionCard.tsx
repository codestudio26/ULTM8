import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, ErrorBanner, Field, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import { useAskCorrection, type GradingStyle, type RankCorrection } from './myGradingQueries';

const NOTE_MAX = 500;

const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/**
 * Backlog 3.13 (Decisions 286, 299): only coaches change belts, but a student
 * whose recorded belt is wrong can ask the School to correct it. They pick
 * the grade they should have, anywhere on the style's ladder, and say why; a
 * reviewer approves or rejects it. Shows the latest request for the style,
 * and, while none is waiting, the way to ask.
 */
export function CorrectionCard({ item, latest }: { item: GradingStyle; latest: RankCorrection | null }) {
  const t = useT();
  const ask = useAskCorrection();
  const [open, setOpen] = useState(false);
  const [rungId, setRungId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const pending = latest?.status === 'PENDING';
  const rungName = (r: RankCorrection['requested']) => r.stripeName ?? r.rankName;

  const send = () => {
    if (!rungId || !note.trim()) return;
    ask.mutate(
      { disciplineId: item.disciplineId, stripeTierId: rungId, note: note.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setRungId(null);
          setNote('');
        },
      },
    );
  };

  return (
    <View accessibilityLabel={t('grading.correction.a11yLabel', { style: item.disciplineName })} style={{ marginTop: spacing[3], borderTopWidth: 1, borderTopColor: theme.border, paddingTop: spacing[2] }}>
      {latest ? (
        <View style={{ marginBottom: spacing[2] }}>
          <Text style={{ fontWeight: '600' }}>
            {latest.status === 'PENDING'
              ? t('grading.correction.waiting', { rank: rungName(latest.requested) })
              : latest.status === 'APPROVED'
                ? t('grading.correction.approved', { rank: rungName(latest.requested) })
                : t('grading.correction.rejected', { rank: rungName(latest.requested) })}
          </Text>
          <Muted>{t('grading.correction.askedOn', { date: formatDate(latest.createdAt) })}</Muted>
          {latest.reviewNote ? <Muted>{t('grading.correction.schoolNote', { note: latest.reviewNote })}</Muted> : null}
        </View>
      ) : null}
      {pending ? null : !open ? (
        <>
          <Muted>{t('grading.correction.intro')}</Muted>
          <Button title={t('grading.correction.ask')} variant="secondary" onPress={() => setOpen(true)} />
        </>
      ) : (
        <View>
          <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{t('grading.correction.pickBelt')}</Text>
          {item.ladder
            .filter((r) => r.id !== item.currentStripeId)
            .map((r) => {
              const on = r.id === rungId;
              return (
                <Pressable
                  key={r.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={r.name}
                  onPress={() => setRungId(r.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: spacing[2],
                    paddingHorizontal: spacing[2],
                    marginBottom: spacing[1],
                    borderRadius: radius.button,
                    borderWidth: 1,
                    borderColor: on ? theme.fillAccent : theme.border,
                  }}
                >
                  <View style={{ width: 28, height: 10, borderRadius: 2, backgroundColor: r.primaryColour, borderWidth: 1, borderColor: theme.borderStrong, marginRight: spacing[2] }} />
                  <Text style={{ flex: 1, fontWeight: on ? '600' : '400' }}>{r.name}</Text>
                </Pressable>
              );
            })}
          <Field label={t('grading.correction.noteLabel')} hint={t('grading.correction.noteHint')}>
            <TextField value={note} onChangeText={setNote} maxLength={NOTE_MAX} multiline accessibilityLabel={t('grading.correction.noteLabel')} />
          </Field>
          {ask.error ? <ErrorBanner message={getApiErrorMessage(ask.error, t('grading.correction.sendError'))} /> : null}
          <Button title={t('grading.correction.send')} loading={ask.isPending} disabled={!rungId || !note.trim()} onPress={send} />
          <Button title={t('grading.correction.cancel')} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      )}
    </View>
  );
}
