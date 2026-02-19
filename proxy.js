// proxy.js — The Village Inn Sweepstakes Proxy Server
// Handles Betfair odds + Racing API (keeps credentials server-side)
//
// LOCAL:   node proxy.js  (set credentials in .env file)
// RAILWAY: Deploy this file — set environment variables in Railway dashboard

const http  = require('http');
const https = require('https');

// ================================================================
//  CONFIG — loaded from environment variables
//  Locally: create a .env file and run:  node -r dotenv/config proxy.js
//  Railway: set these in the Railway dashboard under Variables
// ================================================================

const PORT = process.env.PORT || 3001;  // Railway sets PORT automatically

const RACING_API_USER = process.env.RACING_API_USER || '';
const RACING_API_PASS = process.env.RACING_API_PASS || '';
const RACING_AUTH     = 'Basic ' + Buffer.from(`${RACING_API_USER}:${RACING_API_PASS}`).toString('base64');

const BETFAIR_USER    = process.env.BETFAIR_USER    || '';
const BETFAIR_PASS    = process.env.BETFAIR_PASS    || '';
const BETFAIR_APP_KEY = process.env.BETFAIR_APP_KEY || '';

// ================================================================
//  BETFAIR SESSION CACHE  (re-used for 8 hours)
// ================================================================

let bfSession = null;

async function getBetfairToken() {
  if (bfSession && bfSession.expires > Date.now()) return bfSession.token;

  console.log('Logging in to Betfair (certificate login)...');

  // Certificate-based login — works from cloud/VPS IPs
  // Set BETFAIR_CERT and BETFAIR_KEY env vars with the contents of client-2048.crt and client-2048.key
  const cert = (process.env.BETFAIR_CERT || '').replace(/\\n/g, '\n');
  const key  = (process.env.BETFAIR_KEY  || '').replace(/\\n/g, '\n');

  if (!cert || !key) throw new Error('BETFAIR_CERT and BETFAIR_KEY environment variables are required');

  const body = `username=${encodeURIComponent(BETFAIR_USER)}&password=${encodeURIComponent(BETFAIR_PASS)}`;

  const resp = await new Promise((resolve, reject) => {
    const opts = {
      hostname: 'identitysso-cert.betfair.com',
      path: '/api/certlogin',
      method: 'POST',
      cert,
      key,
      headers: {
        'X-Application':  BETFAIR_APP_KEY,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });

  let json;
  try { json = JSON.parse(resp.body); }
  catch(e) { throw new Error('Betfair cert login returned non-JSON (HTTP ' + resp.status + '): ' + resp.body.slice(0,200)); }
  if (json.loginStatus !== 'SUCCESS') throw new Error('Betfair cert login failed: ' + (json.loginStatus || 'unknown'));

  bfSession = { token: json.sessionToken, expires: Date.now() + 8 * 60 * 60 * 1000 };
  console.log('Betfair session established via certificate');
  return bfSession.token;
}

// ================================================================
//  BETFAIR ODDS FETCHER
// ================================================================

async function fetchOdds(venue, date) {
  const token = await getBetfairToken();
  const bfHeaders = {
    'X-Application':    BETFAIR_APP_KEY,
    'X-Authentication': token,
    'Content-Type':     'application/json',
    'Accept':           'application/json'
  };

  const catalogueResp = await betfairRpc(bfHeaders, 'listMarketCatalogue', {
    filter: { eventTypeIds: ['7'], marketCountries: ['GB', 'IE'],
              marketStartTime: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } },
    marketProjection: ['RUNNER_DESCRIPTION', 'EVENT', 'MARKET_START_TIME'],
    maxResults: '200'
  });

  const allMarkets  = Array.isArray(catalogueResp) ? catalogueResp : (catalogueResp.result || []);
  const venueUpper  = venue.toUpperCase();
  const venueMarkets = allMarkets.filter(m => {
    const v = (m.event?.venue || m.event?.name || '').toUpperCase();
    return v.includes(venueUpper) || venueUpper.includes(v.split(' ')[0]);
  });
  const excludePatterns = /each way|to be placed|\d+ tbp|tbp|antepost|specials/i;
  const markets = venueMarkets.filter(m => !excludePatterns.test(m.marketName));

  if (!markets.length) {
    const available = [...new Set(allMarkets.map(m => m.event?.venue || m.event?.name || '?'))];
    console.log(`No markets matched "${venue}". Available: ${available.join(', ')}`);
    return { byTime: {}, flat: {} };
  }

  const bookResp = await betfairRpc(bfHeaders, 'listMarketBook', {
    marketIds: markets.map(m => m.marketId),
    priceProjection: { priceData: ['EX_BEST_OFFERS'] },
    orderProjection: 'EXECUTABLE', currencyCode: 'GBP'
  });
  const books = Array.isArray(bookResp) ? bookResp : (bookResp.result || []);

  const mktRunnerMap = {};
  const mktTimeMap   = {};
  for (const mkt of markets) {
    mktRunnerMap[mkt.marketId] = {};
    for (const runner of (mkt.runners || [])) mktRunnerMap[mkt.marketId][runner.selectionId] = runner.runnerName;
    const t = new Date(mkt.marketStartTime);
    mktTimeMap[mkt.marketId] = String(t.getUTCHours()).padStart(2,'0') + ':' + String(t.getUTCMinutes()).padStart(2,'0');
  }

  const oddsMap = {}, oddsMapFlat = {};
  for (const book of books) {
    const runnerMap = mktRunnerMap[book.marketId] || {};
    const raceTime  = mktTimeMap[book.marketId]   || '00:00';
    for (const runner of (book.runners || [])) {
      if (runner.status === 'REMOVED') continue;
      const name = runnerMap[runner.selectionId];
      if (!name) continue;
      const price = (runner.lastPriceTraded > 1) ? runner.lastPriceTraded : runner.ex?.availableToBack?.[0]?.price;
      if (price && price > 1) {
        const frac = decToFrac(price);
        oddsMap[raceTime + '|' + name.toUpperCase()] = frac;
        oddsMapFlat[name.toUpperCase()] = frac;
      }
    }
  }
  console.log(`Odds: ${Object.keys(oddsMap).length} runners across ${markets.length} races`);
  return { byTime: oddsMap, flat: oddsMapFlat };
}

async function betfairRpc(headers, method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', method: `SportsAPING/v1.0/${method}`, params, id: 1 });
  const resp = await httpsPost('api.betfair.com', '/exchange/betting/json-rpc/v1', headers, body);
  const json = JSON.parse(resp.body);
  if (json.error) throw new Error('Betfair RPC error: ' + JSON.stringify(json.error));
  return json.result ?? {};
}

// ================================================================
//  HELPERS
// ================================================================

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

function httpsPost(hostname, path, headers = {}, body = '') {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      res => { let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data })); }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

function decToFrac(dec) {
  if (!dec || dec <= 1) return 'EVS';
  const n = dec - 1;
  const table = [
    [0.2,'1/5'],[0.25,'1/4'],[0.33,'1/3'],[0.4,'2/5'],[0.5,'1/2'],[0.67,'2/3'],
    [0.75,'3/4'],[0.8,'4/5'],[1,'EVS'],[1.25,'5/4'],[1.5,'6/4'],[1.75,'7/4'],
    [2,'2/1'],[2.5,'5/2'],[3,'3/1'],[3.5,'7/2'],[4,'4/1'],[4.5,'9/2'],
    [5,'5/1'],[6,'6/1'],[7,'7/1'],[8,'8/1'],[9,'9/1'],[10,'10/1'],
    [12,'12/1'],[14,'14/1'],[16,'16/1'],[20,'20/1'],[25,'25/1'],
    [33,'33/1'],[40,'40/1'],[50,'50/1'],[66,'66/1'],[100,'100/1']
  ];
  let best = table[0], minDiff = Math.abs(n - table[0][0]);
  for (const f of table) { const d = Math.abs(n - f[0]); if (d < minDiff) { minDiff = d; best = f; } }
  return best[1];
}

// ================================================================
//  HTTP SERVER
// ================================================================

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  const url = req.url;

  if (url === '/' || url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', service: 'Village Inn Sweepstakes Proxy' })); return;
  }

  if (url.startsWith('/odds')) {
    const params = new URLSearchParams(url.split('?')[1] || '');
    const venue = params.get('venue'), date = params.get('date');
    if (!venue || !date) { res.writeHead(400); res.end(JSON.stringify({ error: 'venue and date required' })); return; }
    try {
      const result = await fetchOdds(venue, date);
      res.writeHead(200); res.end(JSON.stringify({ odds: result.byTime, oddsFlat: result.flat, count: Object.keys(result.byTime).length }));
    } catch(err) {
      console.error('Odds error:', err.message);
      if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message, odds: {}, oddsFlat: {} })); }
    }
    return;
  }

  if (url.startsWith('/api/')) {
    const apiPath = url.replace('/api', '/v1');
    console.log('Racing API:', apiPath);
    const proxyReq = https.request(
      { hostname: 'api.theracingapi.com', path: apiPath, method: 'GET', headers: { 'Authorization': RACING_AUTH } },
      proxyRes => {
        let data = '';
        proxyRes.on('data', c => data += c);
        proxyRes.on('end', () => { res.writeHead(proxyRes.statusCode); res.end(data); });
      }
    );
    proxyReq.on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); });
    proxyReq.end();
    return;
  }

  if (url.startsWith('/debug-results')) {
    const day = new URLSearchParams(url.split('?')[1]||'').get('day') || 'today';
    const proxyReq = https.request(
      { hostname: 'api.theracingapi.com', path: `/v1/results/${day}/free`, method: 'GET', headers: { 'Authorization': RACING_AUTH } },
      proxyRes => {
        let data = '';
        proxyRes.on('data', c => data += c);
        proxyRes.on('end', () => {
          try {
            const results = JSON.parse(data).results || [];
            res.writeHead(200); res.end(JSON.stringify({ total: results.length, sample: results.slice(0,3) }, null, 2));
          } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
        });
      }
    );
    proxyReq.on('error', err => { if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); }});
    proxyReq.end();
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: 'Unknown route' }));
});

// ================================================================
//  AUTO-REFRESH — Odds & Results 11am-6pm every 30min
//  Requires: npm install firebase-admin + serviceAccountKey.json
//  On Railway: set FIREBASE_SERVICE_ACCOUNT env var with JSON content
// ================================================================

let autoRefreshInterval = null;

async function autoRefreshOddsAndResults() {
  const hour = new Date().getUTCHours() + 1; // UTC+1 Ireland/UK
  if (hour < 11 || hour >= 18) return;
  console.log('Auto-refresh running...');

  let admin;
  try { admin = require('firebase-admin'); }
  catch(e) {
    console.log('firebase-admin not installed — skipping auto-refresh');
    if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
    return;
  }

  if (!admin.apps.length) {
    try {
      const credential = process.env.FIREBASE_SERVICE_ACCOUNT
        ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
        : admin.credential.cert(require('./serviceAccountKey.json'));
      admin.initializeApp({ credential });
    } catch(e) {
      console.log('Firebase Admin init failed:', e.message);
      if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
      return;
    }
  }

  const db = admin.firestore();
  try {
    const cfg = await db.collection('config').doc('activeMeeting').get();
    if (!cfg.exists) return;
    const { venue, date, day } = cfg.data();
    if (!venue || !date) return;

    // Odds
    try {
      const odds = await fetchOdds(venue, date);
      if (Object.keys(odds.byTime).length > 0) {
        const racesSnap = await db.collection('races').where('date','==',date).get();
        let matched = 0;
        for (const raceDoc of racesSnap.docs) {
          const race = raceDoc.data();
          const [h,m] = (race.time||'00:00').split(':').map(Number);
          const nh = (h>=1&&h<=9)?h+12:h;
          const nt = String(nh).padStart(2,'0')+':'+String(m).padStart(2,'0');
          const updated = (race.runners||[]).map(r => {
            const odd = odds.byTime[nt+'|'+r.name.toUpperCase()] || odds.flat[r.name.toUpperCase()];
            if (odd) { matched++; return {...r, odds: odd}; }
            return r;
          });
          await raceDoc.ref.update({ runners: updated, oddsUpdatedAt: new Date().toISOString() });
        }
        console.log(`Odds: updated ${matched} runners`);
      }
    } catch(e) { console.log('Odds error:', e.message); }

    // Results
    if (day) {
      try {
        const rd = await new Promise((resolve, reject) => {
          const req = https.request(
            { hostname:'api.theracingapi.com', path:`/v1/results/${day}/free`, method:'GET', headers:{'Authorization':RACING_AUTH} },
            res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} }); }
          );
          req.on('error',reject); req.end();
        });
        const vr = (rd.results||[]).filter(r=>(r.course||'').toLowerCase()===venue.toLowerCase());
        const racesSnap = await db.collection('races').where('date','==',date).get();
        let updated = 0;
        for (const result of vr) {
          const apiId = (result.race_id||result.id||'').toString();
          const match = racesSnap.docs.find(d=>d.data().apiId===apiId);
          if (!match||match.data().result) continue;
          const runners = result.runners||[];
          const pos  = n => runners.find(r=>parseInt(r.position||r.finishing_position)===n);
          const name = r => r?(r.horse||r.name||''):'';
          const w = pos(1); if (!w) continue;
          await match.ref.update({ result:{winner:name(w),second:name(pos(2)),third:name(pos(3)),fourth:name(pos(4)),recordedAt:new Date().toISOString(),recordedBy:'auto-scheduler'} });
          updated++;
        }
        console.log(`Results: ${updated} new result(s)`);
      } catch(e) { console.log('Results error:', e.message); }
    }
  } catch(e) { console.log('Auto-refresh error:', e.message); }
}

server.listen(PORT, () => {
  console.log('');
  console.log('Village Inn Sweepstakes Proxy — port ' + PORT);
  console.log('');
  if (!BETFAIR_USER || !RACING_API_USER) {
    console.log('WARNING: Credentials not set. Create a .env file or set environment variables.');
  } else {
    console.log('Credentials OK');
  }
  console.log('Routes: /health  /odds  /api/*  /debug-results');
  console.log('');
  autoRefreshOddsAndResults();
  autoRefreshInterval = setInterval(autoRefreshOddsAndResults, 30 * 60 * 1000);
});
