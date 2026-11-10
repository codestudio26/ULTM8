// Where use-fakes.cjs writes the port its fake R2 storage took for an API
// listening on `apiPort` (Decision 451 item 11), so the journeys can find it
// without a fixed port. REHEARSAL_R2_PORT, when set, wins on both sides.
const os = require('os');
const path = require('path');
const fs = require('fs');

function fakeR2PortFile(apiPort) {
  return path.join(os.tmpdir(), `ultm8-rehearsal-fake-r2-${apiPort}.port`);
}

/** The fake R2's base URL for the API at `apiUrl` (e.g. http://localhost:3317/v1). */
function fakeR2Url(apiUrl) {
  if (process.env.REHEARSAL_R2_PORT) return `http://localhost:${process.env.REHEARSAL_R2_PORT}`;
  const u = new URL(apiUrl);
  const apiPort = u.port || (u.protocol === 'https:' ? 443 : 80);
  const file = fakeR2PortFile(apiPort);
  let port;
  try {
    port = fs.readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(`No fake R2 port for the API on port ${apiPort} (${file}). Start the API with --require ./scripts/rehearsal/use-fakes.cjs, or set REHEARSAL_R2_PORT.`);
  }
  return `http://localhost:${port}`;
}

module.exports = { fakeR2PortFile, fakeR2Url };
