import { HttpsProxyAgent } from 'https-proxy-agent';
import { httpsProxyAgentFor } from './proxy-agent';

describe('httpsProxyAgentFor', () => {
  const proxy = 'http://proxy.internal:3128';

  it('is undefined without a proxy', () => {
    expect(httpsProxyAgentFor('places.googleapis.com', {})).toBeUndefined();
  });

  it('proxies a host NO_PROXY does not cover', () => {
    expect(httpsProxyAgentFor('places.googleapis.com', { HTTPS_PROXY: proxy, NO_PROXY: 'localhost,api.stripe.com' })).toBeInstanceOf(HttpsProxyAgent);
  });

  it.each(['googleapis.com', '.googleapis.com', '*.googleapis.com', 'places.googleapis.com', '*'])('skips the proxy when NO_PROXY has %s', (entry) => {
    expect(httpsProxyAgentFor('places.googleapis.com', { https_proxy: proxy, no_proxy: entry })).toBeUndefined();
  });
});
