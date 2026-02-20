// proxy.js — Village Inn Sweepstakes Proxy
// Racing API only — odds entered manually by admin

const http  = require('http');
const https = require('https');

const PORT = process.env.PORT || 3001;

// ================================================================
// ENVIRONMENT VARIABLES
// ================================================================

const RACING_API_USER = process.env.RACING_API_USER || '';
const RACING_API_PASS = process.env.RACING_API_PASS || '';
const RACING_AUTH     = 'Basic ' + Buffer.from(`${RACING_API_USER}:${RACING_API_PASS}`).toString('base64');

if (!RACING_API_USER || !RACING_API_PASS) {
  console.log('⚠️  WARNING: RACING_API_USER / RACING_API_PASS missing in .env');
}

// ================================================================
// RACING API HELPER
// ================================================================

function racingApiGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.theracingapi.com',
        path,
        method: 'GET',
        headers: {
          'Authorization': RACING_AUTH,
          'Accept': 'application/json'
        }
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch(e) {
            reject(new Error(`Racing API non-JSON (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ================================================================
// HTTP SERVER
// ================================================================

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url      = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ---- Health check ----
  if (pathname === '/' || pathname === '/health') {
    res.end(JSON.stringify({ status: 'ok', service: 'Village Inn Proxy', ts: new Date().toISOString() }));
    return;
  }

  // ---- Proxy: /api/* → Racing API ----
  // e.g. /api/racecards/free?day=today
  //      /api/results/today/free
  if (pathname.startsWith('/api/')) {
    const apiPath = pathname.replace('/api', '') + (url.search || '');
    try {
      const { status, body } = await racingApiGet('/v1' + apiPath);
      res.statusCode = status;
      res.end(JSON.stringify(body));
    } catch (err) {
      console.error('Racing API error:', err.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ---- Results endpoint (alias, fetches today or specific day) ----
  // /results?date=YYYY-MM-DD&venue=Cheltenham
  if (pathname === '/results') {
    const date  = url.searchParams.get('date');
    const venue = url.searchParams.get('venue');

    if (!date) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'date parameter required (YYYY-MM-DD)' }));
      return;
    }

    try {
      // Racing API: results by date
      const { status, body } = await racingApiGet(`/v1/results?start_date=${date}&end_date=${date}`);
      if (status !== 200) {
        res.statusCode = status;
        res.end(JSON.stringify(body));
        return;
      }

      // Filter by venue if provided
      let results = body.results || body.racecards || body.races || [];
      if (venue) {
        results = results.filter(r =>
          (r.course || r.venue || '').toLowerCase() === venue.toLowerCase()
        );
      }

      // Normalise each result into a consistent shape:
      // { race_id, race_name, course, off_time, runners: [{position, horse, ...}] }
      const normalised = results.map(r => ({
        race_id:   r.race_id || r.id || '',
        race_name: r.race_name || r.name || 'Unknown Race',
        course:    r.course || r.venue || '',
        off_time:  r.off_time || r.time || '',
        runners:   (r.runners || []).map(h => ({
          position:  parseInt(h.position || h.finishing_position || h.finish_position || 99),
          horse:     h.horse || h.name || '',
          horse_id:  h.horse_id || h.runner_id || h.id || '',
          jockey:    h.jockey || '',
          trainer:   h.trainer || '',
          sp:        h.sp || h.starting_price || ''
        })).sort((a, b) => a.position - b.position)
      }));

      res.end(JSON.stringify({ results: normalised, date, venue: venue || null }));
    } catch (err) {
      console.error('Results error:', err.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Village Inn Sweepstakes Proxy       ║');
  console.log(`║  Port: ${PORT}                          ║`);
  console.log('║  Racing API: ✅  Betfair: ❌ removed  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
});
