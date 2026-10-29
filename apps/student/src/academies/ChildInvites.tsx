import React from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { theme, spacing, fontSize, radius } from '../theme/tokens';

type ChildInvite = components['schemas']['ChildInviteDto'];

/** Decision 403: Schools asking this Guardian to add a child. */
function useChildInvites() {
  return useQuery({
    queryKey: ['child-invites'],
    queryFn: () => unwrap(apiClient.GET('/v1/child-invites/me')),
  });
}

function useAnswerChildInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      if (accept) await unwrap(apiClient.POST('/v1/child-invites/{id}/accept', { params: { path: { id } } }));
      else await unwrap(apiClient.POST('/v1/child-invites/{id}/decline', { params: { path: { id } } }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['child-invites'] });
      await queryClient.invalidateQueries({ queryKey: ['my-minors'] });
    },
  });
}

/**
 * Home: "Add {child} to {School}?" for each child a School owner added with
 * this account as their Guardian (Decision 403). Accepting adds the child to
 * this account (or uses the same child already on it) and enrols them; no
 * answer, no change.
 */
export function ChildInvites() {
  const invites = useChildInvites();
  const items = invites.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <>
      {items.map((invite) => (
        <ChildInviteCard key={invite.id} invite={invite} />
      ))}
    </>
  );
}

function ChildInviteCard({ invite }: { invite: ChildInvite }) {
  const t = useT();
  const answer = useAnswerChildInvite();
  const child = `${invite.childFirstName} ${invite.childSurname}`.trim();
  return (
    <View
      accessibilityLabel={t('academies.childInvites.title', { child, school: invite.schoolName })}
      style={{ marginBottom: spacing[4], backgroundColor: theme.bgSuccess, borderRadius: radius.button, padding: spacing[4] }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {t('academies.childInvites.title', { child, school: invite.schoolName })}
      </Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>
        {t('academies.childInvites.body', { child, school: invite.schoolName })}
      </Text>
      {answer.isError ? <ErrorBanner message={getApiErrorMessage(answer.error, t('academies.signUpInvites.failed'))} /> : null}
      <Button title={t('academies.signUpInvites.accept')} loading={answer.isPending} onPress={() => answer.mutate({ id: invite.id, accept: true })} />
      <Button title={t('academies.signUpInvites.decline')} variant="secondary" disabled={answer.isPending} onPress={() => answer.mutate({ id: invite.id, accept: false })} />
    </View>
  );
}
