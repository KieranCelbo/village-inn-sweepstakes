// proxy.js — Village Inn Sweepstakes Dev Proxy
// Standard Plan: /v1/racecards/standard for odds + place terms from Bet365
// Usage: node proxy.js

const http  = require('http');
const https = require('https');
const url   = require('url');

const PORT            = 3001;
const RACING_API_HOST = 'api.theracingapi.com';
const RACING_USER     = process.env.RACING_API_USER || 'fuwREPyxqI4LasWJ9NLW7dhP';
const RACING_PASS     = process.env.RACING_API_PASS || 'lBWdv3TFp78P2gZw8zT472nZ';
const RACING_AUTH     = 'Basic ' + Buffer.from(`${RACING_USER}:${RACING_PASS}`).toString('base64');

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function racingAPI(path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: RACING_API_HOST, path: '/v1' + path, method: 'GET',
        headers: { Authorization: RACING_AUTH, Accept: 'application/json' } },
      res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try   { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
          catch { resolve({ status: res.statusCode, data: { error: 'Bad JSON', raw: body.slice(0,500) } }); }
        });
      }
    );
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

function normVenue(v) {
  return String(v||'').replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim().toLowerCase();
}

// Parse off_time field from API
// off_time is ISO format e.g. "2026-02-23 13:50:00" or just "13:50"
// Returns "HH:MM" in 24h format
function parseOffTime(off_time) {
  if (!off_time) return '00:00';
  const s = String(off_time);
  // ISO datetime: "2026-02-23 13:50:00" or "2026-02-23T13:50:00"
  const isoMatch = s.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/);
  if (isoMatch) return isoMatch[0].slice(-5); // last 5 chars = "HH:MM"
  // Plain time: "13:50" or "1:50"
  const timeMatch = s.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1]);
    const m = timeMatch[2];
    if (h >= 1 && h <= 9) h += 12; // normalise AM ambiguity
    return String(h).padStart(2,'0') + ':' + m;
  }
  return '00:00';
}

// Extract Bet365 entry from runner.odds array
// Fields confirmed: bookmaker, fractional, decimal, ew_places, ew_denom
function getBet365(runner) {
  const oddsArr = runner.odds || [];
  if (!Array.isArray(oddsArr) || !oddsArr.length) return null;

  // Try Bet365 first, then fall back to first bookmaker
  const entry = oddsArr.find(o => String(o.bookmaker||'').toLowerCase().replace(/\s/g,'') === 'bet365')
             || oddsArr[0];

  if (!entry) return null;

  return {
    fractional:  entry.fractional || 'SP',
    ew_places:   parseInt(entry.ew_places) || 0,  // e.g. 2 (number of places paid)
    ew_denom:    parseInt(entry.ew_denom)  || 4,  // e.g. 4 (place fraction denominator: 1/4)
    bookmaker:   entry.bookmaker || 'unknown',
    isbet365:    String(entry.bookmaker||'').toLowerCase().replace(/\s/g,'') === 'bet365'
  };
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// GET /api/racecards/standard?day=today|tomorrow
// Pass-through — admin.html uses this to browse/load meetings
// IMPORTANT: field is off_time (ISO datetime), horse field is "horse"
async function handleRacecards(req, res, params) {
  const day = params.day || 'today';
  console.log(`  -> GET /v1/racecards/standard (day hint: ${day})`);
  const r = await racingAPI('/racecards/standard');
  res.writeHead(r.status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(r.data));
}

// GET /api/results/today — correct endpoint per Racing API docs
async function handleResultsToday(req, res) {
  console.log('  -> GET /v1/results/today');
  const r = await racingAPI('/results/today');
  res.writeHead(r.status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(r.data));
}

// GET /api/results/standard?course=X — date-filtered results (uses /v1/results/today for now)
async function handleResults(req, res, params) {
  // Standard plan: /v1/results/today is the correct endpoint
  // For past dates the endpoint is /v1/results?start_date=X&end_date=X
  const qs = [];
  if (params.start_date) qs.push(`start_date=${encodeURIComponent(params.start_date)}`);
  if (params.end_date)   qs.push(`end_date=${encodeURIComponent(params.end_date)}`);
  if (params.course)     qs.push(`course=${encodeURIComponent(params.course)}`);
  if (params.region)     qs.push(`region=${encodeURIComponent(params.region)}`);
  const path = qs.length ? '/results?' + qs.join('&') : '/results/today';
  console.log(`  -> GET /v1${path}`);
  const r = await racingAPI(path);
  res.writeHead(r.status, {'Content-Type':'application/json'});
  res.end(JSON.stringify(r.data));
}

// GET /odds?venue=Cheltenham&date=YYYY-MM-DD
// Returns odds + Bet365 place terms for every runner at a venue
// {
//   odds:          { "13:50|HORSE NAME": "5/1" },
//   runnerDetails: { "13:50|HORSE NAME": { fractional, ew_places, ew_denom, bookmaker } },
//   racePlaces:    { "13:50": { ew_places, ew_denom, bookmaker } }  ← per race
// }
async function handleOdds(req, res, params) {
  const venue = (params.venue || '').trim();
  if (!venue) {
    res.writeHead(400, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'venue param required'}));
    return;
  }

  console.log(`  -> Odds for "${venue}"`);
  const r = await racingAPI('/racecards/standard');

  if (r.status !== 200) {
    res.writeHead(r.status, {'Content-Type':'application/json'});
    res.end(JSON.stringify(r.data));
    return;
  }

  const racecards  = r.data.racecards || [];
  const allCourses = [...new Set(racecards.map(rc => rc.course))];
  const venueRaces = racecards.filter(rc => normVenue(rc.course) === normVenue(venue));

  if (!venueRaces.length) {
    console.log(`  -> No match for "${venue}" — available: ${allCourses.slice(0,8).join(', ')}`);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({
      odds: {}, runnerDetails: {}, racePlaces: {},
      venue, racesFound: 0,
      apiCourses: allCourses.slice(0, 10).join(', ')
    }));
    return;
  }

  const oddsMap     = {};  // "HH:MM|HORSE NAME" → "5/1"
  const detailsMap  = {};  // "HH:MM|HORSE NAME" → { fractional, ew_places, ew_denom, bookmaker }
  const racePlaces  = {};  // "HH:MM"            → { ew_places, ew_denom, bookmaker }
  let runnerCount   = 0;
  let bet365Count   = 0;

  for (const race of venueRaces) {
    // off_time is ISO datetime: "2026-02-23 13:50:00"
    const timeKey = parseOffTime(race.off_time);

    // Derive race-level place terms from first runner with valid ew data
    // (all runners in same race typically have same ew_places/ew_denom)
    let racePlacesEntry = null;

    for (const runner of (race.runners || [])) {
      const name = String(runner.horse || '').toUpperCase();
      if (!name) continue;

      const b365 = getBet365(runner);
      if (!b365) continue;

      const key = `${timeKey}|${name}`;
      oddsMap[key]    = b365.fractional;
      detailsMap[key] = {
        fractional:  b365.fractional,
        ew_places:   b365.ew_places,
        ew_denom:    b365.ew_denom,
        bookmaker:   b365.bookmaker
      };

      if (!racePlacesEntry && b365.ew_places > 0) {
        racePlacesEntry = { ew_places: b365.ew_places, ew_denom: b365.ew_denom, bookmaker: b365.bookmaker };
      }

      if (b365.isbet365) bet365Count++;
      runnerCount++;
    }

    if (racePlacesEntry) racePlaces[timeKey] = racePlacesEntry;
  }

  console.log(`  -> ${venueRaces.length} races, ${runnerCount} runners, ${bet365Count} with Bet365`);

  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({
    odds: oddsMap,
    runnerDetails: detailsMap,
    racePlaces,
    venue,
    racesFound: venueRaces.length,
    runnerCount,
    bet365Count
  }));
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname.replace(/\/$/, '') || '/';
  const params   = parsed.query;

  console.log(`[${new Date().toLocaleTimeString('en-IE')}] ${req.method} ${pathname}`);

  try {
    if (pathname === '/health') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({status:'ok', time:new Date().toISOString()}));
      return;
    }
    if (pathname === '/api/racecards/standard') return await handleRacecards(req, res, params);
    if (pathname === '/api/racecards/free')     return await handleRacecards(req, res, params);
    if (pathname === '/api/results/standard')   return await handleResults(req, res, params);
    if (pathname === '/api/results/today')      return await handleResultsToday(req, res);
    if (pathname === '/api/results/today/free') return await handleResultsToday(req, res);
    if (pathname === '/api/results/free')       return await handleResultsToday(req, res);
    if (pathname === '/odds')                   return await handleOdds(req, res, params);

    if (pathname === '/admin/delete-auth-user') return await handleDeleteAuthUser(req, res);
    if (pathname === '/admin/delete-auth-user-by-email') return await handleDeleteAuthUserByEmail(req, res);

    res.writeHead(404, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ error:'Not found', path: pathname }));
  } catch (err) {
    console.error('  !! Error:', err.message);
    res.writeHead(500, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error: err.message}));
  }
});

// ── Firebase Admin — delete Auth user ────────────────────────────────────────
// Requires: npm install firebase-admin
// Set env var: FIREBASE_SERVICE_ACCOUNT = path to serviceAccountKey.json
// OR paste the JSON as FIREBASE_SERVICE_ACCOUNT_JSON env var
let firebaseAdmin = null;
// Load service account from file (upload cheltenham-sweepstakes-firebase-adminsdk.json to same folder as proxy.js)
const path = require('path');
const SA_PATH = process.env.FIREBASE_SA_PATH || path.join(__dirname, 'cheltenham-sweepstakes-firebase-adminsdk.json');
let SERVICE_ACCOUNT;
try {
  SERVICE_ACCOUNT = require(SA_PATH);
  console.log('  -> Service account loaded from', SA_PATH);
} catch(e) {
  console.error('  !! Could not load service account from', SA_PATH, '—', e.message);
  SERVICE_ACCOUNT = null;
}

async function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) { firebaseAdmin = admin; return admin; }
    if (!SERVICE_ACCOUNT) throw new Error('Service account not loaded — check cheltenham-sweepstakes-firebase-adminsdk.json is in the same folder as proxy.js');
    admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });
    firebaseAdmin = admin;
    console.log('  -> Firebase Admin initialised');
    return admin;
  } catch(e) {
    console.warn('  !! firebase-admin not available:', e.message, '— run: npm install firebase-admin');
    return null;
  }
}

async function handleDeleteAuthUserByEmail(req, res) {
  let body = '';
  req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  let email;
  try { email = JSON.parse(body).email; } catch { }
  if (!email) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'email required'})); return; }
  const admin = await getFirebaseAdmin();
  if (!admin) { res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Firebase Admin not configured'})); return; }
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(user.uid);
    console.log(`  -> Deleted orphaned Auth account ${email} (${user.uid})`);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true, uid: user.uid}));
  } catch(e) {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:false, error:e.message}));
  }
}

async function handleDeleteAuthUser(req, res) {
  let body = '';
  req.on('data', c => body += c);
  await new Promise(r => req.on('end', r));
  let uid;
  try { uid = JSON.parse(body).uid; } catch { }
  if (!uid) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'uid required'})); return; }
  const admin = await getFirebaseAdmin();
  if (!admin) {
    res.writeHead(503, {'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'Firebase Admin not configured on proxy — set FIREBASE_SERVICE_ACCOUNT_JSON env var'}));
    return;
  }
  try {
    await admin.auth().deleteUser(uid);
    console.log(`  -> Deleted Auth user ${uid}`);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ok:true, uid}));
  } catch(e) {
    console.warn(`  -> Auth delete failed for ${uid}:`, e.message);
    res.writeHead(200, {'Content-Type':'application/json'}); // 200 so client treats as non-fatal
    res.end(JSON.stringify({ok:false, error:e.message}));
  }
}

server.listen(PORT, () => {
  console.log('');
  console.log('  Village Inn — Dev Proxy (Standard Plan)');
  console.log(`  http://localhost:${PORT}/health`);
  console.log('');
  console.log('  Key field names confirmed from API:');
  console.log('  race.off_time = "2026-02-23 13:50:00"');
  console.log('  runner.horse  = "Orkney Blue"');
  console.log('  runner.odds[].bookmaker = "Bet365"');
  console.log('  runner.odds[].fractional = "3/1"');
  console.log('  runner.odds[].ew_places = "2"');
  console.log('  runner.odds[].ew_denom = "4"  (means 1/4 odds a place)');
  console.log('');
});
