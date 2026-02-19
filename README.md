# 🏇 Cheltenham Sweepstakes App

A full pub sweepstakes app for the Cheltenham Festival — with Firebase auth, race API integration, admin controls, and player pick management.

---

## 🚀 Quick Start (Local Testing)

### 1. Install a local server
```bash
npx serve . -p 3000
```
Or install globally:
```bash
npm install -g serve
serve . -p 3000
```

### 2. Open in browser
```
http://localhost:3000
```

---

## 🔥 Firebase Setup (One-Time)

### Step 1: Enable Email/Password Auth
1. Go to https://console.firebase.google.com
2. Select project: **cheltenham-sweepstakes**
3. Go to **Authentication → Sign-in method**
4. Enable **Email/Password**

### Step 2: Create Firestore Database
1. Go to **Firestore Database**
2. Click **Create Database**
3. Start in **test mode** (for now, then apply rules below)

### Step 3: Create First Admin User
Since you can't log in without an admin, create the first one manually:

1. Go to **Authentication → Users → Add User**
2. Email: `admin@cheltenham.local`
3. Password: (your choice)
4. Copy the **UID** from the user list

5. Go to **Firestore → Add Document**
   - Collection: `users`
   - Document ID: (paste the UID from step 4)
   - Fields:
     ```
     displayName: "Admin"
     username: "admin"
     role: "admin"
     email: "admin@cheltenham.local"
     ```

6. Log in at `http://localhost:3000` with:
   - Username: `admin`
   - Password: (what you set)

### Step 4: Apply Security Rules (Optional but recommended)
Copy the contents of `firestore.rules` into:
**Firestore → Rules** tab

---

## 📱 How to Use

### Admin
1. Log in → you're taken to the **Admin Dashboard**
2. **Users tab**: Add players with username & password
3. **Races tab**: Click "Fetch Today's Races" to load from Racing API
4. **Results tab**: Record race winners + override any player picks
5. **Leaderboard**: See who's winning

### Players
1. Log in with username/password set by admin
2. See all today's races with horses and odds
3. Tap any horse to pick it
4. Tap again to deselect
5. Picks lock automatically **30 minutes before race time**
6. See results and winners in real-time

---

## 🏗️ File Structure

```
cheltenham-sweepstakes/
├── index.html        ← Login page
├── admin.html        ← Admin dashboard
├── user.html         ← Player picks page
├── styles.css        ← Shared styles
├── firestore.rules   ← Security rules for Firebase
└── README.md         ← This file
```

---

## 🔌 APIs Used

- **Firebase Auth** — Login/logout
- **Firebase Firestore** — Store users, races, picks, results
- **The Racing API** — Fetch live racecards from Cheltenham
  - Base URL: `https://api.theracingapi.com/v1`
  - Credentials: As configured in admin.html

---

## ⚠️ Notes

- Race lock is calculated client-side (30 mins before race time)
- Admin can override any pick at any time, even after lock
- Leaderboard scores by number of winning picks
- Racing API on free plan — check rate limits
- Password reset currently stores a note in Firestore; for full reset functionality, use Firebase Admin SDK on a backend

---

## 🎨 Design

- **Green & Gold** — Classic racing colours
- Large, clear fonts for older users
- Mobile-friendly responsive layout
- Horse cards are large tap targets
- Clear lock indicators on each race
