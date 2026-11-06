import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Button, ErrorBanner, SuccessBanner } from '../components/ui';
import { StepUpPrompt } from '../auth/StepUpPrompt';
import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import { useAccountDeletionPreview, useRequestAccountDeletion, type AccountDeletionState } from './accountDeletionQueries';

const fullName = (c: { firstName: string; surname: string }) => `${c.firstName} ${c.surname}`.trim();

/**
 * "Delete my account" (required by Apple before App Store submission). Says
 * plainly what happens — locked at once, deleted for good after 30 days unless
 * the member signs in again, what is removed and what the Schools keep, and
 * which children go with the account — then asks for the passcode again
 * (step-up) before asking the API. The main owner of an open School or
 * Franchise is told to hand it over or close it first, with no delete button.
 * Confirmation is inline, not Alert.alert (a no-op on React Native Web).
 */
export function DeleteAccountScreen() {
  const t = useT();
  const { logout } = useAuth();
  const preview = useAccountDeletionPreview();
  const request = useRequestAccountDeletion();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<AccountDeletionState | null>(null);

  if (preview.isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.surface0 }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (preview.isError || !preview.data) {
    return (
      <View style={{ flex: 1, padding: spacing[4], backgroundColor: theme.surface0 }}>
        <ErrorBanner message={getApiErrorMessage(preview.error, t('profile.deleteAccount.loadFailed'))} />
      </View>
    );
  }

  const state = done ?? preview.data;
  if (state.pending) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
        <SuccessBanner message={t('profile.deleteAccount.done', { date: state.dueAt ? formatDate(state.dueAt) : '' })} />
        {state.childrenDeleted.length > 0 ? (
          <Text style={body}>{t('profile.deleteAccount.doneChildren', { names: state.childrenDeleted.map(fullName).join(', ') })}</Text>
        ) : null}
        <Button title={t('profile.deleteAccount.signOut')} onPress={() => void logout()} />
      </ScrollView>
    );
  }

  const days = state.graceDays;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
      <Text style={body}>{t('profile.deleteAccount.intro', { days })}</Text>

      {state.blockedBy.length > 0 ? (
        <View testID="delete-account-blocked" style={{ gap: spacing[2] }}>
          <Text style={heading}>{t('profile.deleteAccount.blockedTitle')}</Text>
          {state.blockedBy.map((b) => (
            <Text key={b.id} style={body}>
              {t(b.kind === 'FRANCHISE' ? 'profile.deleteAccount.blockedFranchise' : 'profile.deleteAccount.blockedSchool', { name: b.name })}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={heading}>{t('profile.deleteAccount.removedTitle')}</Text>
      <Text style={body}>{t('profile.deleteAccount.removed')}</Text>
      <Text style={heading}>{t('profile.deleteAccount.keptTitle')}</Text>
      <Text style={body}>{t('profile.deleteAccount.kept')}</Text>
      <Text style={body}>{t('profile.deleteAccount.payments')}</Text>

      {state.childrenDeleted.length > 0 ? (
        <View testID="delete-account-children" style={{ gap: spacing[1] }}>
          <Text style={heading}>{t('profile.deleteAccount.childrenDeletedTitle')}</Text>
          <Text style={body}>{t('profile.deleteAccount.childrenDeletedHint', { days })}</Text>
          {state.childrenDeleted.map((c) => (
            <Text key={c.studentId} style={[body, { fontWeight: fontWeight.emphasis }]}>
              {fullName(c)}
            </Text>
          ))}
        </View>
      ) : null}
      {state.childrenKept.length > 0 ? (
        <View style={{ gap: spacing[1] }}>
          <Text style={heading}>{t('profile.deleteAccount.childrenKeptTitle')}</Text>
          {state.childrenKept.map((c) => (
            <Text key={c.studentId} style={body}>
              {t(c.reason === 'OWN_LOGIN' ? 'profile.deleteAccount.keptOwnLogin' : 'profile.deleteAccount.keptOtherParent', { name: fullName(c) })}
            </Text>
          ))}
        </View>
      ) : null}

      {request.isError ? <ErrorBanner message={getApiErrorMessage(request.error, t('profile.deleteAccount.failed'))} /> : null}

      {state.blockedBy.length === 0 ? (
        confirming ? (
          <StepUpPrompt
            onCancel={() => setConfirming(false)}
            onVerified={(stepUpToken) =>
              request.mutate(stepUpToken, {
                onSuccess: (result) => setDone(result),
                onSettled: () => setConfirming(false),
              })
            }
          />
        ) : (
          <Button title={t('profile.deleteAccount.confirm')} variant="destructive" loading={request.isPending} onPress={() => setConfirming(true)} />
        )
      ) : null}
    </ScrollView>
  );
}

const body = { color: theme.textPrimary, fontSize: fontSize.body } as const;
const heading = { color: theme.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.emphasis, marginTop: spacing[2] } as const;
