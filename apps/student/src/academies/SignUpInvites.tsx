import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { useAuth } from '../auth/AuthContext';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { useAcademy } from './academyQueries';

type SignUpInvite = components['schemas']['SignUpInviteDto'];

/** Decision 392: Schools that approved this account's front-desk sign-up. */
function useSignUpInvites() {
  return useQuery({
    queryKey: ['sign-up-invites'],
    queryFn: () => unwrap(apiClient.GET('/v1/sign-ups/invites/me')),
  });
}

function useAnswerInvite() {
  const queryClient = useQueryClient();
  const { applyAccessToken } = useAuth();
  return useMutation({
    mutationFn: async ({ id, accept, branchId }: { id: string; accept: boolean; branchId?: string }) => {
      if (!accept) {
        await unwrap(apiClient.POST('/v1/sign-ups/invites/{id}/decline', { params: { path: { id } } }));
        return;
      }
      const res = await unwrap(apiClient.POST('/v1/sign-ups/invites/{id}/accept', { params: { path: { id } }, body: branchId ? { branchId } : {} }));
      // The new STUDENT grant is on a fresh token (as when joining a School).
      if (typeof res.accessToken === 'string') await applyAccessToken(res.accessToken);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sign-up-invites'] }),
  });
}

/**
 * Home: "Join {School}?" for each School whose staff approved a sign-up made
 * on its front-desk tablet with this account's email (Decision 392). Joining
 * happens only when the person says yes here; no answer, no change.
 */
export function SignUpInvites() {
  const invites = useSignUpInvites();
  const items = invites.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <>
      {items.map((invite) => (
        <InviteCard key={invite.id} invite={invite} />
      ))}
    </>
  );
}

function InviteCard({ invite }: { invite: SignUpInvite }) {
  const t = useT();
  const answer = useAnswerInvite();
  const academy = useAcademy(invite.needsBranch ? invite.schoolId : null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const ready = !invite.needsBranch || !!branchId;
  return (
    <View
      accessibilityLabel={t('academies.signUpInvites.title', { school: invite.schoolName })}
      style={{ marginBottom: spacing[4], backgroundColor: theme.bgSuccess, borderRadius: radius.button, padding: spacing[4] }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {t('academies.signUpInvites.title', { school: invite.schoolName })}
      </Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>
        {invite.kind === 'VISITOR' ? t('academies.signUpInvites.bodyVisitor', { school: invite.schoolName }) : t('academies.signUpInvites.body', { school: invite.schoolName })}
      </Text>
      {invite.needsBranch ? (
        <View style={{ marginTop: spacing[2] }}>
          <Text style={{ fontWeight: '600' }}>{t('academies.signUpInvites.homeBranch')}</Text>
          {(academy.data?.branches ?? []).map((b) => (
            <Button key={b.id} title={b.name} variant={branchId === b.id ? 'primary' : 'secondary'} onPress={() => setBranchId(b.id)} />
          ))}
        </View>
      ) : null}
      {answer.isError ? <ErrorBanner message={getApiErrorMessage(answer.error, t('academies.signUpInvites.failed'))} /> : null}
      <Button
        title={t('academies.signUpInvites.accept')}
        loading={answer.isPending}
        disabled={!ready}
        onPress={() => answer.mutate({ id: invite.id, accept: true, branchId: branchId ?? undefined })}
      />
      <Button title={t('academies.signUpInvites.decline')} variant="secondary" disabled={answer.isPending} onPress={() => answer.mutate({ id: invite.id, accept: false })} />
    </View>
  );
}
