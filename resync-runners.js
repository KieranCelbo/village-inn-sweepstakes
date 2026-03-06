require('dotenv').config();
const https = require('https');
const admin = require('firebase-admin');
const path = require('path');

// Load live service account
const SA_PATH = process.env.FIREBASE_SA_PATH || path.join(__dirname, 'cheltenham-sweepstakes-firebase-adminsdk.json');
const serviceAccount = require(SA_PATH);

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const RACING_AUTH = 'Basic ' + Buffer.from(
  `${process.env.RACING_API_USER}:${process.env.RACING_API_PASS}`
).toString('base64');

function normHorse(name) { return String(name||'').replace(/(?:\s*\([^)]+\))+\s*$/,'').trim().toLowerCase(); }

async function callAPI(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.theracingapi.com',
      path: '/v1' + path,
      headers: { Authorization: RACING_AUTH }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Invalid JSON: ' + body.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Parse fractional odds e.g. "5/1" → 5.0, "Evs" → 1.0
function parseOdds(oddsStr) {
  if (!oddsStr || oddsStr === 'SP' || oddsStr === '') return null;
  const s = String(oddsStr).trim().toLowerCase();
  if (s === 'evs' || s === 'evens' || s === '1/1') return 1.0;
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) { const n = parseFloat(frac[1]), d = parseFloat(frac[2]); if (d > 0) return n / d; }
  return null;
}

async function resyncRunners() {
  // Get active meeting
  const cfg = await db.collection('config').doc('activeMeeting').get();
  if (!cfg.exists) { console.log('No active meeting'); return; }
  const meeting = cfg.data();
  const today    = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (meeting.date !== today && meeting.date !== tomorrow) {
    console.log(`Active meeting (${meeting.date}) is not today or tomorrow — skipping`);
    return;
  }

  console.log(`Re-syncing ${meeting.venue} (${meeting.date})…`);

  // Fetch racecards (pass day param for tomorrow support)
  const day = meeting.date === tomorrow ? 'tomorrow' : 'today';
  const data = await callAPI(`/racecards/standard${day === 'tomorrow' ? '?day=tomorrow' : ''}`);

  const venueRaces = (data.racecards||[]).filter(r =>
    (r.course||'').toLowerCase().replace(/\s*\([a-z]{2,3}\)\s*$/, '').trim() ===
    meeting.venue.toLowerCase().trim()
  );

  if (!venueRaces.length) {
    console.log('No races found from API for', meeting.venue);
    const available = [...new Set((data.racecards||[]).map(r=>r.course))].slice(0,8);
    console.log('Available courses:', available.join(', '));
    return;
  }

  const racesSnap = await db.collection('races').where('date','==',meeting.date).get();
  let updatedCount = 0;
  let nrCount = 0;
  let picksReassigned = 0;

  for (const raceDoc of racesSnap.docs) {
    const stored = raceDoc.data();
    const fresh = venueRaces.find(r => (r.race_id||r.id||'').toString() === stored.apiId);
    if (!fresh) continue;

    const freshRunnerNames = (fresh.runners||[]).map(h => normHorse(h.horse||h.name||''));
    const newlyNR = []; // horse names just becoming NR this run

    const updatedRunners = (stored.runners||[]).map(runner => {
      const freshData = (fresh.runners||[]).find(h =>
        normHorse(h.horse||h.name||'') === normHorse(runner.name)
      );
      const stillPresent = freshRunnerNames.includes(normHorse(runner.name));
      const apiNR = freshData && !!(
        freshData.non_runner || freshData.is_non_runner ||
        freshData.status === 'Non Runner' || freshData.status === 'Withdrawn'
      );
      const isNR = !stillPresent || apiNR;

      if (isNR && !runner.nr) {
        nrCount++;
        newlyNR.push(runner.name);
        console.log(`  NR: ${runner.name} (${stored.name})`);
      }

      // Preserve ew_places/ew_denom from stored odds data, update form/jockey/trainer
      return {
        ...runner,
        jockey:    freshData?.jockey    || runner.jockey    || '',
        trainer:   freshData?.trainer   || runner.trainer   || '',
        form:      freshData?.form      || runner.form      || '',
        // Preserve Bet365 place terms — already fetched via /odds endpoint
        ew_places: runner.ew_places || 0,
        ew_denom:  runner.ew_denom  || 4,
        nr: isNR
      };
    });

    await raceDoc.ref.update({ runners: updatedRunners });
    updatedCount++;

    // ── NR Pick Reassignment ──────────────────────────────────────────────
    // For each newly NR horse, find picks and reassign to SP favourite
    if (newlyNR.length > 0 && !stored.result) {
      // Find the SP favourite: non-NR runner with lowest odds
      const activeRunners = updatedRunners.filter(r => !r.nr && r.odds && r.odds !== 'SP');
      activeRunners.sort((a, b) => {
        const odA = parseOdds(a.odds) ?? 999;
        const odB = parseOdds(b.odds) ?? 999;
        return odA - odB;
      });
      const favourite = activeRunners[0] || updatedRunners.find(r => !r.nr);

      if (!favourite) {
        console.log(`  No favourite found for ${stored.name} — cannot reassign picks`);
        continue;
      }

      console.log(`  SP Fav for ${stored.name}: ${favourite.name} (${favourite.odds || 'SP'})`);

      // Find picks on this race for any of the newly NR horses
      const picksSnap = await db.collection('picks')
        .where('raceId', '==', raceDoc.id)
        .get();

      for (const pickDoc of picksSnap.docs) {
        const pick = pickDoc.data();
        if (!pick.horseName) continue;
        const isAffected = newlyNR.some(nr =>
          normHorse(nr) === normHorse(pick.horseName)
        );
        if (!isAffected) continue;

        // Reassign to favourite
        console.log(`  Reassigning pick: ${pick.userId} ${pick.horseName} → ${favourite.name}`);
        await pickDoc.ref.update({
          horseName:       favourite.name,
          nrOriginal:      pick.horseName,   // store what they originally picked
          nrSubstitute:    true,
          nrReassignedAt:  new Date().toISOString()
        });
        picksReassigned++;
      }
    }
  }

  console.log(`Done. ${updatedCount} races updated, ${nrCount} new NR(s), ${picksReassigned} pick(s) reassigned to favourite.`);
}

resyncRunners().catch(console.error).finally(() => process.exit());
