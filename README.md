# WaitWise

Smart public-service queue: take a token, see your live position and predicted wait, get called when it's your turn. Built for hackathon problem **P03 — Smart Public Service Queue Management**. Demo preset: a hospital OPD.

**Live:** [lpu.lol](https://lpu.lol)

## Get the app

### iPhone (via SideStore)

1. Install **SideStore** on your iPhone — [sidestore.io](https://sidestore.io)
2. Add our source: `https://lpu.lol/ios/source.json`
   (or tap this on your phone: [Add to SideStore](sidestore://source?url=https://lpu.lol/ios/source.json))
3. Open **Browse** → **WaitWise** → **Get**. Updates appear in SideStore automatically.

Install page: [lpu.lol/ios](https://lpu.lol/ios)

### Android

Download the APK: [lpu.lol/android](https://lpu.lol/android) — installs over an existing copy so updates carry across.

### Web

No install needed: [lpu.lol](https://lpu.lol) — same features, in the browser.

## Monorepo layout

- `apps/web` — Next.js: patient site, staff counter, kiosk, TV board, admin
- `apps/mobile` — Expo/React Native: the phone app above
- `apps/api` — FastAPI: ML wait-time prediction, DeepSeek AI, payments, notifications
- `supabase/` — self-hosted Postgres, Auth, Realtime, PostgREST, and every queue-rule migration

## Team

Yash Dhanda · Raghav · Satyam Singh
