import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * The agent an outbound HTTPS request to `host` goes through when the process
 * runs behind an HTTPS proxy: `HTTPS_PROXY` (or `https_proxy`) is set and
 * `NO_PROXY` doesn't cover the host. Node's own `https`/`fetch` never read the
 * proxy variables by themselves (Node 22's `fetch` only does with
 * NODE_USE_ENV_PROXY), so without this a proxied network blocks the call.
 * Undefined when no proxy applies, so the request goes out directly as before.
 *
 * Shared by Stripe (`stripeProxyAgent`) and Google Places (`address-lookup`).
 */
export function httpsProxyAgentFor(host: string, env: NodeJS.ProcessEnv = process.env): HttpsProxyAgent<string> | undefined {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy) return undefined;
  const target = host.toLowerCase();
  const noProxy = (env.NO_PROXY || env.no_proxy || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const bypassed = noProxy.some((entry) => {
    if (entry === '*') return true;
    const domain = entry.replace(/^\*?\./, '');
    return target === domain || target.endsWith(`.${domain}`);
  });
  return bypassed ? undefined : new HttpsProxyAgent(proxy);
}
