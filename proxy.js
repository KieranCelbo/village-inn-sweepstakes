// proxy.js — Village Inn Sweepstakes Proxy (Ubuntu CERT version)

const http  = require('http');
const https = require('https');
const fs    = require('fs');

const PORT = process.env.PORT || 3001;

// =============================
// ENVIRONMENT VARIABLES
// =============================

const RACING_API_USER = process.env.RACING_API_USER || '';
const RACING_API_PASS = process.env.RACING_API_PASS || '';
const RACING_AUTH     = 'Basic ' + Buffer.from(`${RACING_API_USER}:${RACING_API_PASS}`).toString('base64');

const BETFAIR_USER    = process.env.BETFAIR_USER    || '';
const BETFAIR_PASS    = process.env.BETFAIR_PASS    || '';
const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY || '';

if (!BETFAIR_USER || !BETFAIR_PASS || !BETFAIR_APP_KEY) {
  console.log('⚠️  WARNING: Betfair credentials missing in .env');
}

// =============================
// CERT FILES (local to server)
// =============================

const BETFAIR_CERT = fs.readFileSync('./client-2048.crt');
const BETFAIR_KEY  = fs.readFileSync('./client-2048.key');

// =============================
// BETFAIR SESSION CACHE
// =============================

let bfSession = null;

async function getBetfairToken() {
  if (bfSession && bfSession.expires > Date.now()) {
    return bfSession.token;
  }

  console.log('Logging in to Betfair (CERT login)...');

  const body =
    `username=${encodeURIComponent(BETFAIR_USER)}` +
    `&password=${encodeURIComponent(BETFAIR_PASS)}`;

  const resp = await httpsCertPost(
    'identitysso-cert.betfair.com',
    '/api/certlogin',
    {
      'X-Application': BETFAIR_APP_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body
  );

  let json;
  try {
    json = JSON.parse(resp.body);
  } catch (e) {
    throw new Error(
      `Betfair CERT login returned non-JSON (HTTP ${resp.status}): ` +
      resp.body.slice(0, 300)
    );
  }

  if (json.status !== 'SUCCESS') {
    throw new Error('Betfair CERT login failed: ' + JSON.stringify(json));
  }

  bfSession = {
    token: json.sessionToken,
    expires: Date.now() + 8 * 60 * 60 * 1000
  };

  console.log('Betfair CERT session established');
  return bfSession.token;
}

// =============================
// BETFAIR RPC CALL
// =============================

async function betfairRpc(headers, method, params) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: `SportsAPING/v1.0/${method}`,
    params,
    id: 1
  });

  const resp = await httpsPost(
    'api.betfair.com',
    '/exchange/betting/json-rpc/v1',
    headers,
    body
  );

  let json;
  try {
    json = JSON.parse(resp.body);
  } catch (e) {
    throw new Error(
      `Betfair RPC ${method} returned non-JSON (HTTP ${resp.status}): ` +
      resp.body.slice(0, 300)
    );
  }

  if (json.error) {
    throw new Error('Betfair RPC error: ' + JSON.stringify(json.error));
  }

  return json.result ?? {};
}

// =============================
// FETCH ODDS
// =============================

async function fetchOdds(venue, date) {
  const token = await getBetfairToken();

  const headers = {
    'X-Application':    BETFAIR_APP_KEY,
    'X-Authentication': token,
    'Content-Type':     'application/json',
    'Accept':           'application/json'
  };

  const markets = await betfairRpc(headers, 'listMarketCatalogue', {
    filter: {
      eventTypeIds: ['7'],
      marketCountries: ['GB', 'IE'],
      marketStartTime: {
        from: `${date}T00:00:00Z`,
        to: `${date}T23:59:59Z`
      }
    },
    marketProjection: ['RUNNER_DESCRIPTION', 'EVENT', 'MARKET_START_TIME'],
    maxResults: '200'
  });

  if (!Array.isArray(markets) || !markets.length) {
    return {};
  }

  const books = await betfairRpc(headers, 'listMarketBook', {
    marketIds: markets.map(m => m.marketId),
    priceProjection: { priceData: ['EX_BEST_OFFERS'] }
  });

  const odds = {};

  for (const book of books) {
    for (const runner of (book.runners || [])) {
      if (runner.status === 'REMOVED') continue;

      const price =
        runner.lastPriceTraded > 1
          ? runner.lastPriceTraded
          : runner.ex?.availableToBack?.[0]?.price;

      if (price) {
        odds[runner.selectionId] = price;
      }
    }
  }

  return odds;
}

// =============================
// HTTPS HELPERS
// =============================

function httpsPost(hostname, path, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () =>
          resolve({ status: res.statusCode, body: data })
        );
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsCertPost(hostname, path, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        key: BETFAIR_KEY,
        cert: BETFAIR_CERT,
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body)
        }
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () =>
          resolve({ status: res.statusCode, body: data })
        );
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// =============================
// SERVER
// =============================

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/health') {
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url.startsWith('/odds')) {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const venue = params.get('venue');
    const date  = params.get('date');

    try {
      const data = await fetchOdds(venue, date);
      res.end(JSON.stringify(data));
    } catch (err) {
      console.error('Odds error:', err.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('Village Inn Sweepstakes Proxy — CERT LOGIN');
  console.log('Port:', PORT);
  console.log('');
});