import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
import { theme, spacing, fontSize, radius, minTouchTarget } from '../theme/tokens';
import { CURRENT_POLICY_VERSION } from '../guardians/ConsentTierRow';
import { LegalLinks } from '../legal/LegalLinks';

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
    mutationFn: async ({ id, accept, consent }: { id: string; accept: boolean; consent?: boolean }) => {
      // Decision 430 item 9: the consent ticked here is recorded with the child.
      if (accept) {
        await unwrap(apiClient.POST('/v1/child-invites/{id}/accept', { params: { path: { id } }, body: consent ? { consentPolicyVersion: CURRENT_POLICY_VERSION } : {} }));
      }
      else await unwrap(apiClient.POST('/v1/child-invites/{id}/decline', { params: { path: { id } } }));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['child-invites'] });
      await queryClient.invalidateQueries({ queryKey: ['my-minors'] });
      await queryClient.invalidateQueries({ queryKey: ['my-consent-records'] });
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
  const [consent, setConsent] = useState(false);
  const child = `${invite.childFirstName} ${invite.childSurname}`.trim();
  // Decision 430 item 6: an invite to be another parent of a child already at the School.
  const title = invite.addsGuardian ? 'academies.childInvites.guardianTitle' : 'academies.childInvites.title';
  const body = invite.addsGuardian ? 'academies.childInvites.guardianBody' : 'academies.childInvites.body';
  return (
    <View
      accessibilityLabel={t(title, { child, school: invite.schoolName })}
      style={{ marginBottom: spacing[4], backgroundColor: theme.bgSuccess, borderRadius: radius.button, padding: spacing[4] }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
        {t(title, { child, school: invite.schoolName })}
      </Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginTop: spacing[1] }}>
        {t(body, { child, school: invite.schoolName })}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: minTouchTarget }}>
        <Switch value={consent} onValueChange={setConsent} accessibilityLabel={t('academies.childInvites.consent', { child: invite.childFirstName })} />
        <Text style={{ flex: 1, fontSize: fontSize.footnote }}>{t('academies.childInvites.consent', { child: invite.childFirstName })}</Text>
      </View>
      <LegalLinks slugs={['children-notice']} />
      {answer.isError ? <ErrorBanner message={getApiErrorMessage(answer.error, t('academies.signUpInvites.failed'))} /> : null}
      <Button title={t('academies.signUpInvites.accept')} loading={answer.isPending} onPress={() => answer.mutate({ id: invite.id, accept: true, consent })} />
      <Button title={t('academies.signUpInvites.decline')} variant="secondary" disabled={answer.isPending} onPress={() => answer.mutate({ id: invite.id, accept: false })} />
    </View>
  );
}
