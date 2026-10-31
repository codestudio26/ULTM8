import { request as httpsRequest } from 'https';
import { httpsProxyAgentFor } from '../common/http/proxy-agent';

/**
 * The one place Google Places is called over the network. Kept behind an
 * injection token so tests swap in a fake and never reach Google.
 *
 * Plain `https` rather than `fetch`: Node's `fetch` ignores HTTPS_PROXY unless
 * NODE_USE_ENV_PROXY is set, so this follows the Stripe client instead and
 * passes the proxy agent explicitly when one applies (`httpsProxyAgentFor`).
 */
export const PLACES_HTTP = Symbol('PLACES_HTTP');

export interface PlacesHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface PlacesHttpResponse {
  status: number;
  body: string;
}

export type PlacesHttp = (req: PlacesHttpRequest) => Promise<PlacesHttpResponse>;

/** Responses larger than this are cut off and treated as a failure. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export const nodePlacesHttp: PlacesHttp = (req) =>
  new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const headers: Record<string, string> = { ...req.headers };
    if (req.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(req.body));
    const outgoing = httpsRequest(
      url,
      { method: req.method, headers, agent: httpsProxyAgentFor(url.hostname), timeout: req.timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            outgoing.destroy(new Error('Address lookup response too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    // `timeout` only fires on an idle socket; this also caps the whole request.
    const overall = setTimeout(() => outgoing.destroy(new Error('Address lookup timed out')), req.timeoutMs);
    outgoing.on('timeout', () => outgoing.destroy(new Error('Address lookup timed out')));
    outgoing.on('error', reject);
    outgoing.on('close', () => clearTimeout(overall));
    if (req.body !== undefined) outgoing.write(req.body);
    outgoing.end();
  });
