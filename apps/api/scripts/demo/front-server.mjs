// One small front server for the demo, so everything is on ONE port and the
// same origin (a phone or a preview pane opens a single URL):
//   /            the School Portal (apps/school-portal, `vite build`)
//   /app/        the member app (apps/student, `expo export -p web`, baseUrl /app)
//   /v1/...      proxied to the API
// Both apps are built with a relative API address, so their calls land here.
//
// Env: FRONT_PORT (8080), API_URL (http://127.0.0.1:3540), PORTAL_DIR, MEMBER_DIR.
// Not for production: no TLS, no caching rules beyond the basics.
import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.FRONT_PORT || 8080);
const API = new URL(process.env.API_URL || 'http://127.0.0.1:3540');
const PORTAL_DIR = path.resolve(process.env.PORTAL_DIR || '/var/tmp/demo-web/portal');
const MEMBER_DIR = path.resolve(process.env.MEMBER_DIR || '/var/tmp/demo-web/member');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4',
};

function sendFile(res, file, req) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const isHtml = type.startsWith('text/html');
  res.writeHead(200, {
    'content-type': type,
    // Hashed bundles can be cached; the HTML shell never is, so a rebuild shows at once.
    'cache-control': isHtml ? 'no-store' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/** Serves a built single-page app from `root`; unknown paths get its index.html. */
function serveSpa(req, res, root, rel) {
  let p;
  try { p = decodeURIComponent(rel.split('?')[0]); } catch { p = '/'; }
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(400); return res.end('bad path'); }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file, req);
    if (!err && st.isDirectory() && fs.existsSync(path.join(file, 'index.html'))) return sendFile(res, path.join(file, 'index.html'), req);
    // A missing asset is a 404; any other path is a client-side route.
    if (path.extname(p) && !p.endsWith('.html')) { res.writeHead(404); return res.end('not found'); }
    const index = path.join(root, 'index.html');
    if (!fs.existsSync(index)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end(`not built yet: ${root}`); }
    sendFile(res, index, req);
  });
}

function proxy(req, res) {
  const headers = { ...req.headers, host: API.host, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': 'http' };
  const up = http.request({ hostname: API.hostname, port: API.port, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: `demo front server: API unreachable (${e.code || e.message})` }));
  });
  req.pipe(up);
}

http.createServer((req, res) => {
  const url = req.url || '/';
  if (url === '/v1' || url.startsWith('/v1/')) return proxy(req, res);
  if (url === '/app') { res.writeHead(302, { location: '/app/' }); return res.end(); }
  if (url.startsWith('/app/')) return serveSpa(req, res, MEMBER_DIR, url.slice('/app'.length));
  return serveSpa(req, res, PORTAL_DIR, url);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`demo front server on :${PORT} — portal ${PORTAL_DIR}, member app ${MEMBER_DIR} at /app/, API ${API.origin} at /v1`);
});
