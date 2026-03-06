// fetch-results.js — Village Inn Sweepstakes
// Runs via cron every 15 mins (11am–7pm) on race days
// Fetches results from Racing API and saves to Firestore

require('dotenv').config();
const https = require('https');
const admin = require('firebase-admin');
const path  = require('path');

// Load live service account
const SA_PATH = process.env.FIREBASE_SA_PATH || path.join(__dirname, 'cheltenham-sweepstakes-firebase-adminsdk.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
const db = admin.firestore();

const RACING_AUTH = 'Basic ' + Buffer.from(
  `${process.env.RACING_API_USER}:${process.env.RACING_API_PASS}`
).toString('base64');

// ─── Helpers ────────────────────────────────────────────────────────────────

function normName(name) {
  return String(name || '').replace(/(?:\s*\([^)]+\))+\s*$/, '').trim().toLowerCase();
}

function namesMatch(a, b) {
  return normName(a) === normName(b);
}

// ─── API call ────────────────────────────────────────────────────────────────

function apiGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.theracingapi.com',
      path: `/v1${path}`,
      headers: { Authorization: RACING_AUTH }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Bad JSON from API: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function fetchResults() {
  const now   = new Date();
  const today = now.toISOString().split('T')[0];
  console.log(`[${new Date().toISOString()}] fetch-results starting for ${today}`);

  const cfg = await db.collection('config').doc('activeMeeting').get();
  if (!cfg.exists) { console.log('No active meeting set — nothing to do.'); return; }

  const meeting = cfg.data();
  if (meeting.date !== today) {
    console.log(`Active meeting is ${meeting.date}, not today (${today}) — skipping.`);
    return;
  }

  console.log(`Active meeting: ${meeting.venue} on ${meeting.date}`);

  // Correct endpoint for Standard plan
  let data;
  try {
    data = await apiGet('/results/today');
  } catch (err) {
    console.error('Results endpoint failed:', err.message);
    return;
  }

  const allResults = data.results || [];
  console.log(`API returned ${allResults.length} total results`);

  const venueResults = allResults.filter(r => namesMatch(r.course || '', meeting.venue));
  console.log(`Matched ${venueResults.length} result(s) for "${meeting.venue}"`);

  if (!venueResults.length) {
    const courses = [...new Set(allResults.map(r => r.course).filter(Boolean))];
    console.log('Courses in API response:', courses.join(', ') || '(none)');
    console.log('No results yet for this venue — will retry next run.');
    return;
  }

  const racesSnap = await db.collection('races').where('date', '==', today).get();
  console.log(`Found ${racesSnap.size} race(s) in Firestore for today`);

  let updated = 0;
  let skipped = 0;

  for (const result of venueResults) {
    const apiId = (result.race_id || result.id || '').toString();
    const match = racesSnap.docs.find(d => d.data().apiId === apiId);

    if (!match) {
      console.log(`  No Firestore match for apiId=${apiId} (${result.race_name || ''})`);
      skipped++;
      continue;
    }

    const raceData = match.data();
    const runners  = result.runners || [];

    const atPos       = n => runners.find(r => parseInt(r.position || r.finishing_position || 99) === n);
    const horseNameRaw = r => r ? String(r.horse || r.name || '').replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim() : '';

    const w = atPos(1);
    if (!w) {
      console.log(`  No winner found for ${raceData.name} — race may not have finished yet`);
      continue;
    }

    // Use Bet365 ew_places from stored runners if available, fall back to runner count
    const storedRunners = raceData.runners || [];
    const runnerWithEw  = storedRunners.find(r => r.ew_places > 0);
    const basePlaces    = runnerWithEw ? runnerWithEw.ew_places : (storedRunners.length <= 7 ? 2 : storedRunners.length <= 14 ? 3 : 4);
    const places        = raceData.extraPlace ? basePlaces + 1 : basePlaces;

    const newWinner = horseNameRaw(w);
    const newSecond = places >= 2 ? horseNameRaw(atPos(2)) : '';
    const newThird  = places >= 3 ? horseNameRaw(atPos(3)) : '';
    const newFourth = places >= 4 ? horseNameRaw(atPos(4)) : '';
    const newFifth  = places >= 5 ? horseNameRaw(atPos(5)) : '';

    // Don't overwrite if result hasn't changed
    const prev = raceData.result || {};
    if (namesMatch(prev.winner || '', newWinner) &&
        namesMatch(prev.second || '', newSecond) &&
        namesMatch(prev.third  || '', newThird) && prev.winner) {
      console.log(`  No change: ${raceData.name} — ${newWinner}`);
      continue;
    }

    await match.ref.update({
      result: {
        winner: newWinner, second: newSecond, third: newThird,
        fourth: newFourth, fifth:  newFifth,
        recordedAt: new Date().toISOString(), recordedBy: 'cron'
      }
    });

    console.log(`  ✅ Saved: ${raceData.name}`);
    console.log(`     1st: ${newWinner}${newSecond?' | 2nd: '+newSecond:''}${newThird?' | 3rd: '+newThird:''}${newFourth?' | 4th: '+newFourth:''}`);
    console.log(`     (${storedRunners.length} runners → ${places} paid places, 1/${runnerWithEw?.ew_denom||4} odds)`);
    updated++;
  }

  console.log(`Done. ${updated} updated, ${skipped} unmatched.`);
}

fetchResults().catch(err => {
  console.error('Fatal error:', err.message);
}).finally(() => process.exit(0));
