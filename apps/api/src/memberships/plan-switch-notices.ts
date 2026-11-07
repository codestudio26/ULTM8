/** The notices' English text, translated in the apps by shape (@ultm8/i18n server/translate.ts). */
export function planSwitchNotice(planTitle: string, endDay: string, nextTitle: string, amount: string) {
  return {
    title: 'Your plan is about to change',
    body: `Your ${planTitle} ends on ${endDay}. Then ${nextTitle} starts and ${amount} is charged to your saved card. Without a saved card, or if ${nextTitle} is full, it simply ends and nothing is charged.`,
  };
}
export function planSwitchedNotice(planTitle: string, nextTitle: string, amount: string) {
  return { title: 'Your plan has changed', body: `Your ${planTitle} has ended and ${nextTitle} has started. ${amount} was charged to your saved card.` };
}
export function planSwitchEndedNotice(planTitle: string, nextTitle: string) {
  return { title: 'Membership ended', body: `Your ${planTitle} has ended. ${nextTitle} couldn't be started, so nothing was charged.` };
}
