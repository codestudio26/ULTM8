import { HttpsProxyAgent } from 'https-proxy-agent';
import { stripeProxyAgent } from './stripe-client.service';

describe('stripeProxyAgent', () => {
  const proxy = 'http://127.0.0.1:3128';

  it('is undefined with no proxy set, so the SDK keeps its own agent', () => {
    expect(stripeProxyAgent({})).toBeUndefined();
  });

  it('sends Stripe through HTTPS_PROXY, or the lower-case https_proxy', () => {
    for (const env of [{ HTTPS_PROXY: proxy }, { https_proxy: proxy }]) {
      const agent = stripeProxyAgent(env);
      expect(agent).toBeInstanceOf(HttpsProxyAgent);
      expect(agent!.proxy.href).toBe(`${proxy}/`);
    }
  });

  it('still proxies when NO_PROXY lists other hosts only', () => {
    expect(stripeProxyAgent({ HTTPS_PROXY: proxy, NO_PROXY: 'localhost,127.0.0.1,.svc.cluster.local,notstripe.com' })).toBeInstanceOf(HttpsProxyAgent);
  });

  it.each(['api.stripe.com', 'stripe.com', '.stripe.com', '*.stripe.com', '*', ' API.Stripe.com '])(
    'goes direct when NO_PROXY covers api.stripe.com (%s)',
    (entry) => {
      expect(stripeProxyAgent({ HTTPS_PROXY: proxy, NO_PROXY: `localhost,${entry}` })).toBeUndefined();
      expect(stripeProxyAgent({ HTTPS_PROXY: proxy, no_proxy: entry })).toBeUndefined();
    },
  );
});
