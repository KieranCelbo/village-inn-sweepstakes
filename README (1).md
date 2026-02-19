# The Village Inn Sweepstakes

A horse racing sweepstakes app for The Village Inn pub.

---

## Deploying to Firebase Hosting

### First time setup (one-off)

Open a terminal in this folder and run:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

Your app will be live at:
- https://cheltenham-sweepstakes.web.app

Pages:
- `/`      Login page
- `/admin` Admin dashboard
- `/user`  Player picks page

---

## Running the Proxy Server (Odds + Results)

The proxy fetches live odds from Betfair and results from The Racing API.
Run it locally during testing:

```bash
node proxy.js
```

To host it permanently (so odds work when your laptop is off), deploy to Railway:

1. Go to railway.app and sign up
2. New Project -> Deploy from GitHub repo (push this folder to GitHub first)
3. Set these environment variables in the Railway dashboard:
   - BETFAIR_USER
   - BETFAIR_PASS
   - BETFAIR_APP_KEY
   - RACING_API_USER
   - RACING_API_PASS
4. Update the proxy URL in admin.html from http://localhost:3001 to your Railway URL

---

## Auto-Refresh (Odds + Results, 11am-6pm every 30 mins)

Requires:
1. npm install firebase-admin
2. serviceAccountKey.json in this folder
   Download from: Firebase Console -> Project Settings -> Service Accounts -> Generate new private key

Never commit serviceAccountKey.json to GitHub.

---

## Adding Players

Admin panel -> Users tab -> + Add Player
Share the app URL and their login with each player.

---

## File Structure

  index.html           Login page
  admin.html           Admin dashboard
  user.html            Player picks page
  styles.css           Shared styles
  proxy.js             Proxy server (Betfair + Racing API)
  firebase.json        Firebase Hosting config
  .firebaserc          Firebase project reference
  firestore.rules      Firestore security rules
  serviceAccountKey.json  (never commit this)
