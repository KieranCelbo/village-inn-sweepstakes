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

function normHorse(name) { return String(name||'').replace(/\s*\([A-Z]{2,3}\)\s*$/,'').trim().toLowerCase(); }

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

  // Standard plan: /racecards/standard (no day param needed)
  const data = await callAPI('/racecards/standard');

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

  for (const raceDoc of racesSnap.docs) {
    const stored = raceDoc.data();
    const fresh = venueRaces.find(r => (r.race_id||r.id||'').toString() === stored.apiId);
    if (!fresh) continue;

    const freshRunnerNames = (fresh.runners||[]).map(h => normHorse(h.horse||h.name||''));

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
        console.log(`  NR: ${runner.name} (${stored.name})`);
      }

      // Also update form from fresh data
      return {
        ...runner,
        jockey:  freshData?.jockey  || runner.jockey  || '',
        trainer: freshData?.trainer || runner.trainer || '',
        form:    freshData?.form    || runner.form    || '',
        nr: isNR
      };
    });

    await raceDoc.ref.update({ runners: updatedRunners });
    updatedCount++;
  }

  console.log(`Done. ${updatedCount} races updated, ${nrCount} new non-runner(s) marked.`);
}

resyncRunners().catch(console.error).finally(() => process.exit());
