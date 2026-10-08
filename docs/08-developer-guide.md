# ৮. ডেভেলপার গাইড

## চালানো

```bash
# ড্যাশবোর্ড (repo-র রুটে থেকে)
cd dashboard
npm install
npm run dev        # স্থানীয় সার্ভার; /api স্বয়ংক্রিয়ভাবে :8000-এ যায়
npm run build      # প্রোডাকশন বিল্ড
npm run lint       # oxlint
npm run test       # vitest

# API (PostgreSQL লাগবে — ডকারের db-তে TimescaleDB আছে; না থাকলে নিচের ডকারে শুধু db তুলুন)
cd backend
go run ./cmd/server
go test ./...
```

পুরো সিস্টেম এক কমান্ডে (PostgreSQL/TimescaleDB + API, ড্যাশবোর্ডও একই Go সার্ভার থেকে চলে):

```bash
docker compose up -d --build   # রিপোর রুট থেকে; অ্যাপ → http://localhost:8082
```

API-র পরিবেশ-ভেরিয়েবল: `DATABASE_URL` (বা `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`), `PORT`, `SEED_DEMO_DATA` (ডাটাবেস খালি থাকলে ডেমো ডেটা বসাবে, ডিফল্ট true), `ENV` (`production` হলে `JWT_SECRET` বাধ্যতামূলক, `SEED_DEMO_DATA=false` বাধ্যতামূলক — ডেমো পাসওয়ার্ড/চাবি সবার জানা — আর ডিভাইস চাবি ছাড়া টেলিমেট্রি বাতিল), `REQUIRE_DEVICE_KEY` (true/false, প্রোডাকশনের ডিফল্ট ওভাররাইড), `JWT_SECRET` (না দিলে প্রতি বুটে র‍্যান্ডম — রিস্টার্টে অ্যাক্সেস টোকেন মরে, রিফ্রেশ দিয়ে ক্লায়েন্ট সামলে নেয়), `GOOGLE_CLIENT_ID` (Google লগইন, ঐচ্ছিক), `ENGINE_INTERVAL` (নিয়ম ইঞ্জিনের টিক, ডিফল্ট `30s`), `TELEMETRY_RETENTION_DAYS` (এর চেয়ে পুরোনো টেলিমেট্রি মুছে যায়; ফাঁকা/0 = সব রাখে), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (সতর্কতা টেলিগ্রামে, ঐচ্ছিক), `STATIC_DIR` (বিল্ড করা ড্যাশবোর্ডের ফোল্ডার)।

## টেলিমেট্রি ও TimescaleDB

ডকারের `db` সার্ভিস `timescale/timescaledb:latest-pg17` ইমেজে চলে (PostgreSQL 17 + TimescaleDB; `shared_preload_libraries=timescaledb` কম্পোজেই দেওয়া)। ডেটা ডিরেক্টরির ফরম্যাট `postgres:17-alpine`-এর মতোই, তাই পুরোনো `pgdata` ভলিউম রিসেট ছাড়াই চলে।

প্রতি বুটে `internal/db/timescale.go`-র `SetupTimescale()` (বারবার চালালেও নিরাপদ):

- `telemetries` টেবিলকে `ts` ধরে **হাইপারটেবিল** বানায় (পুরোনো রো সহ, `migrate_data`)। হাইপারটেবিলের ইউনিক কী-তে সময়ের কলাম থাকতে হয়, তাই প্রাইমারি কী `(id, ts)`; চার্টের কোয়েরির জন্য ইনডেক্স `(farm_slug, ts)`।
- **কম্প্রেশন** — ৭ দিনের পুরোনো চাংক কম্প্রেস হয় (`farm_slug, node` ধরে সেগমেন্ট)। কম্প্রেস করা ডেটা পড়া যায়, দেরিতে আসা রিডিংও বসানো যায়।
- **রিটেনশন** — `TELEMETRY_RETENTION_DAYS` দিলে তার চেয়ে পুরোনো চাংক মুছে যায়; মান বদলে রিস্টার্ট করলেই নতুন নীতি।
- এক্সটেনশন না পেলে (সাধারণ PostgreSQL) লগে সতর্কতা দিয়ে চলতে থাকে — টেবিল সাধারণই থাকে, সব এন্ডপয়েন্ট কাজ করে।

পড়ার দুই এন্ডপয়েন্ট (দুটোই JWT চায়):

```bash
# কাঁচা রিডিং, পুরোনো আগে, পেজিংসহ — ?hours=24 (সর্বোচ্চ ৭২০), ?node=, ?page=&limit= (সর্বোচ্চ ৫০০০)
curl -H "Authorization: Bearer <JWT>" 'http://localhost:8082/api/v1/telemetry?hours=24'

# চার্টের জন্য সময়-বাকেটে গড় — ?hours=, ?bucket=5m|15m|1h|6h|1d (ডিফল্ট 1h), ?node=
curl -H "Authorization: Bearer <JWT>" 'http://localhost:8082/api/v1/telemetry/buckets?hours=168&bucket=1d'
# → {"bucket":"1d","items":[{"ts":"…T00:00:00+06:00","count":48,"soil_moisture":[38,32,25],
#     "air_temp":23.5,"air_humidity":83.3,"tank_level":79.4,"battery_v":11.95}, …]}
```

বাকেট এন্ডপয়েন্টে সব নোডের রিডিং একসাথে গড় হয় (`?node=` দিলে একটার), মাটির আর্দ্রতা জোন ধরে আলাদা গড়। বাকেট বাংলাদেশ সময়ে (UTC+6) মেলানো, তাই `1d` মানে মাঝরাত থেকে মাঝরাত। `tank_level` = 0 মানে "পাঠায়নি" (গ্রহণের সময়ের মতোই), তাই গড়ে ধরা হয় না — কোনো রিডিংই না থাকলে `null`। কোয়েরি PostgreSQL-এর `date_bin` ব্যবহার করে (TimescaleDB-র `time_bucket` নয়), যাতে এক্সটেনশন ছাড়াও ও টেস্টে চলে।

## লগইন

`/api`-র সব রুট বিয়ারার **JWT অ্যাক্সেস টোকেন** চায় (HS256, ১৫ মিনিট মেয়াদ, `JWT_SECRET`-এ সাইনড) — মিডলওয়্যার স্টেটলেস, ডাটাবেস দেখে না। লগইন দুই ভাবে: ইমেইল+পাসওয়ার্ড (bcrypt) বা Google (সার্ভারেই টোকেন যাচাই)। সাথে মেলে একটা **রিফ্রেশ টোকেন** (র‍্যান্ডম, `sessions` টেবিলে ৩০ দিন) — অ্যাক্সেস টোকেনের মেয়াদ শেষ হলে ক্লায়েন্ট নিজেই `POST /api/v1/auth/refresh`-এ নতুন জোড়া নেয় (পুরোনো রিফ্রেশ টোকেন রোটেট হয়), লগআউটে রিফ্রেশ সেশন মুছে যায়।

খোলা রুট: `GET /api/health`, `GET /api/v1/auth/config`, `POST /api/v1/auth/login|refresh|google` আর `POST /api/v1/telemetry` (ডিভাইস প্রোটোকল, docs/05; ডিভাইসের চাবি সেট থাকলে `X-Device-Key` লাগে) — বাকি সব `Authorization: Bearer <JWT>` চায়।

```bash
# লগইন → {user, token (JWT), refreshToken}
curl -X POST http://localhost:8082/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@farm.com","password":"farm123"}'

# JWT দিয়ে যেকোনো রুট
curl -H "Authorization: Bearer <JWT>" http://localhost:8082/api/v1/farm

# মেয়াদ শেষ হলে রিফ্রেশ (নতুন জোড়া দেয়, পুরোনো রিফ্রেশ বাতিল)
curl -X POST http://localhost:8082/api/v1/auth/refresh \
  -H 'Content-Type: application/json' -d '{"refreshToken":"<রিফ্রেশ>"}'

# বাকি: GET /api/v1/auth/me (কে লগইন), POST /api/v1/auth/logout {refreshToken}
```

ডেমো অ্যাকাউন্ট (পাসওয়ার্ড সবগুলোর **farm123**, users টেবিলে না থাকলে বসে): **owner@farm.com** (মালিক), **baba@farm.com** (অপারেটর), **guest@farm.com** (দর্শক)। ড্যাশবোর্ড ও মোবাইল দুটোই টোকেন জোড়া রাখে — ৪০১ পেলে আগে চুপচাপ রিফ্রেশ করে অনুরোধ আবার পাঠায়, রিফ্রেশও ব্যর্থ হলে লগইন/কানেক্ট স্ক্রিনে ফেরত যায়।

**ভূমিকা অনুযায়ী অনুমতি** — সার্ভারেই কার্যকর (`router.go`-র গ্রুপ + `patchFarm`-এর ফিল্ড চেক), UI শুধু সেই নিয়ম মিরর করে (`useCan()`):

| লেখা (write) | দর্শক | অপারেটর | মালিক |
|---|---|---|---|
| সব GET (পড়া) | ✓ | ✓ | ✓ |
| সেচ নিয়ন্ত্রণ (পাম্প, ভালভ, মোড, সীমা, ট্যাংক, নিয়ম) | ✗ | ✓ | ✓ |
| কাজ, সময়সূচি, পরিদর্শনের খাতা, ডিভাইস কমান্ড | ✗ | ✓ | ✓ |
| মাঠ (fields), হিসাব (ledger), মজুত (stock) | ✗ | ✗ | ✓ |
| ফার্মের নাম / নোটিফিকেশন / simulate / অবস্থান | ✗ | ✗ | ✓ |
| ব্যবহারকারী, অডিট লগ, ডিভাইসের চাবি দেখা | ✗ | ✗ | ✓ |

অনুমতি নেই এমন লেখায় সার্ভার ৪০৩ দেয় — "এই কাজের অনুমতি আপনার ভূমিকার (দর্শক) নেই।" — আর ক্লায়েন্টে ওই বাটন/সুইচ নিজেই নিষ্ক্রিয় বা লুকানো থাকে।

**Google লগইন (ঐচ্ছিক):** `GOOGLE_CLIENT_ID` সেট করলে দুই ক্লায়েন্টেই "Google দিয়ে লগইন" বাটন আসে — ড্যাশবোর্ডে Google Identity Services বাটন, মোবাইলে expo-auth-session। ক্লায়েন্ট শুধু Google-এর আইডি টোকেন আনে; সার্ভার `POST /api/v1/auth/google`-এ সেটি Google-এর কাছে যাচাই করে (iss/aud/email_verified) ইমেইল দিয়ে অ্যাকাউন্ট খুলে দেয় (নতুনরা 'দর্শক' ভূমিকা পায়)। OAuth ক্লায়েন্ট বানানোর ধাপ `.env.example`-এ। খালি রাখলে বাটন থাকেই না, ইমেইল+পাসওয়ার্ড চলতে থাকে।

## ভাষা (i18n)

দুই ক্লায়েন্টেই [i18next](https://www.i18next.com) + react-i18next — বাংলা (ডিফল্ট ও ফলব্যাক) ও ইংরেজি। স্ট্রিং `src/i18n/{bn,en}.json`-এ (মোবাইল যমজ, `m.*` অংশটা মোবাইল-এক্সক্লুসিভ), কম্পোনেন্টে `useTranslation()`-এর `t('key')`, কম্পোনেন্টের বাইরে (স্টোর অ্যাকশন, lib) `i18n.t()`। ভাষা বদলায় সেটিংস পেজের বাটন দিয়ে (`setLang`) — ড্যাশবোর্ডে localStorage, মোবাইলে AsyncStorage (`farm-command-lang`)।

যেসব জিনিস ভাষা অনুসরণ করে: সব UI লেখা, টোস্ট, সংখ্যার অঙ্ক (`bn()` — বাংলায় ০-৯, ইংরেজিতে ASCII), সময়ের লেবেল (`whenLabel`)। যেসব করে **না**: সার্ভারে জমা ডেটা (কাজের লেখা, খাতার খাত, সেচের লগ, নাম) আর API-র এরর বার্তা — এগুলো বাংলাতেই থাকে। ডেটা-ভ্যালু এনাম (জোন, কবে/due, ভূমিকা, পর্যবেক্ষণের ধরন, খাত) ডাটাবেসে ও ফিল্টারে বাংলাই — শুধু দেখানো লেবেল বদলায় (`lib/labels.ts`-এর `zoneLabel`/`dueLabel`/…, অজানা মান যেমন হাতে লেখা খাত মানসই দেখায়)।

নতুন স্ট্রিং যোগ করতে: দুই JSON-এ কী বসিয়ে কোডে `t('key')` — ইংরেজি কী মিস হলে বাংলাই দেখাবে (ফলব্যাক)। নতুন ভাষা যোগ করতে: JSON + `Lang` টাইপ + সেটিংসের `LANGS` লিস্ট — তিন জায়গায় (dashboard, mobile, রিসোর্স ফাইল)।

## কোডের কাঠামো

```
backend/
  cmd/server/main.go     API সার্ভার চালু করে + নিয়ম ইঞ্জিনের goroutine
  internal/api/          REST হ্যান্ডলার, রিসোর্স অনুযায়ী ফাইল — router.go (পুরো রুট টেবিল, ভূমিকা অনুযায়ী ভাগ), respond.go (এরর, findInFarm, জেনেরিক ডিলিট), paging.go; farm.go (স্ন্যাপশট ও সেচ-নিয়ন্ত্রণ), fields/tasks/ledger/stock/schedules/observations/harvests.go, water.go (পাম্প রান ও রিপোর্ট), devices.go, telemetry.go, alerts.go, weather.go, users.go, audit.go, auth.go, jwt.go — রুট ও নিয়ম: [09-api-reference.md](09-api-reference.md)
  internal/engine/       নিয়ম ইঞ্জিন — প্রতি ৩০ সেকেন্ডে (ENGINE_INTERVAL) প্রতি ফার্মে: অটো সেচ, Duration শেষে বন্ধ, নিয়ম r1 (বৃষ্টি) ও r2 (ট্যাংক < ২০%), সময়সূচি, সেন্সর ড্রিফট (Simulate হলে); Step() খাঁটি ফাংশন (ঘড়ি ইনজেক্ট করা), Engine শেল DB-তে লেখে
  internal/pump/         "পাম্পের অবস্থা বদলাল" — একটাই বাস্তবায়ন (SetManual, SyncRelay); REST ও ইঞ্জিন দুজনেই এটা ডাকে, MQTT এলে কমান্ড এখান থেকে যাবে
  internal/water/        পানির হিসাব: PumpRun খোলা-বন্ধ (Sync/Burst), লিটার, মাঠভিত্তিক প্রতি-কেজিতে-লিটার (Efficiency)
  internal/sensors/      সেন্সরের ভরসা — আটকে থাকা/লাফ/অসম্ভব মান ধরা (Analyze), ইনজেস্টের ভ্যালিডেশন
  internal/alerts/       সার্ভারের সতর্কতা — ইঞ্জিনের টিকে মূল্যায়ন, Alert টেবিলে অবস্থা, টেলিগ্রামে অ্যাক্টিভেশন (TELEGRAM_BOT_TOKEN/CHAT_ID)
  internal/weather/      Open-Meteo ক্লায়েন্ট (৩০ মিনিট ক্যাশ) — GET /api/v1/weather ও ইঞ্জিনের r1 নিয়ম
  internal/bangla/       বাংলা অঙ্কে সংখ্যা (লগ ও সতর্কতার লেখার জন্য)
  internal/db/           PostgreSQL সংযোগ, মাইগ্রেশন, TimescaleDB সেটআপ (timescale.go) ও ডেমো ডেটা
  internal/models/       ডাটাবেসের স্কিমা; JSON ট্যাগ ড্যাশবোর্ডের types.ts-এর সাথে মেলে
dashboard/
  src/
    App.tsx                 পেজ বাছাই, ডেটা-সোর্স (সিমুলেটর/লাইভ) ও হিস্ট্রি-রাউটার নেভিগেশন চালু
    index.css               Tailwind, থিমের রঙ, ফন্ট
    types.ts                সব ডেটার টাইপ (FarmData, Field, Task ...)
    i18n/                   ভাষার ফাইল (bn.json, en.json) ও i18next সেটআপ
    atoms/                  jotai অ্যাটম — farm.ts: ফার্মের সব ডেটা (localStorage-এ সংরক্ষিত), অ্যাকশন ও লাইভ ফ্ল্যাগ, লাইভ মোডে অ্যাকশন API-তে যায়; auth.ts: সেশন ও useCan()
    data/                   নমুনা ডেটা (seed), ধ্রুবক, চার্টের নমুনা ইতিহাস
    hooks/                  use-simulator (শুধু নমুনা-মোডের টাইমার; সার্ভার ডেটা সব `services/`-এ)
    lib/                    farm.ts (সতর্কতা ও সুপারিশের যুক্তি), format.ts (বাংলা অঙ্ক), agro.ts, devices.ts, csv.ts, report.ts (রিপোর্টের হিসাব, ইউনিট-টেস্টসহ), labels.ts, nav.ts, tone.ts, query-client.ts
    services/               API কল ও TanStack Query হুক — পেজগুলো এখান থেকেই ডেটা পড়ে
                            (http.ts র‍্যাপার, source.ts ডেমো/লাইভ সুইচ, রিসোর্স অনুযায়ী ফাইল)
    components/
      ui/                   shadcn ধাঁচের বেস কম্পোনেন্ট
      layout/               গাঢ় সবুজ সাইডবার (গ্রুপ করা মেনু, ব্যবহারকারী ও লগআউট) ও অ্যাপ শেল (স্টিকি হেডার)
      panel.tsx             আইকন-হেডারসহ কার্ড; কার্ডের শিরোনামে `<CardTitle icon={…}>`
      stat-tile.tsx, gauge.tsx   মূল সংখ্যার টাইল ও রিং গেজ
      echart.tsx            ECharts র‍্যাপার
    pages/<পেজ>/           প্রতি পেজের কম্পোনেন্ট
```

## ফর্ম

সব ফর্ম react-hook-form-এ (`useForm` + `Controller`): টেক্সট ইনপুট `register`-এ, ChoiceChips-এর মতো কন্ট্রোলড কম্পোনেন্ট `Controller`-এ। ভ্যালিডেশনের বার্তা বাংলায়, ফিল্ডের নিচে দেখায়; বাংলা অঙ্কের ইনপুট `toNum` দিয়ে পড়ুন (`lib/format.ts`)। জমা দিলে ফর্ম `reset()` হয়।

**নিয়ম:** কম্পোনেন্ট বা পেজে `useState` দিয়ে ফর্ম বানাবেন না, আর `http`/`useQuery`/`useMutation` সরাসরি ডাকবেন না — সব API কল ও TanStack Query হুক `src/services/`-এ (যেমন `useLogin`, `useLogout`, `useUpdateProfile`, `useFarmSnapshot`, `useLedgerRange`); পেজ শুধু হুক ডাকে ও ফর্মের `handleSubmit`-এ `mutate` চালায়। **স্টেট-নিয়ম:** শুধু গ্লোবাল স্টেট (ফার্ম কন্ট্রোল, ডেমো ডেটা, অথ, সংযোগ) jotai-তে — ড্যাশবোর্ড (`atoms/`) ও মোবাইল (`state/`) দুই জায়গায়ই; বাকি সব সার্ভার ডেটা `src/services/`-এর TanStack Query হুকে, আর পেজ সেই হুক সরাসরি ডাকে (মাঝে আলাদা `hooks/` ওয়ার্পার নয়)।

## ডেমো ডেটা (seed) তিন জায়গায় একই রাখুন

`backend/internal/db/seed.go` (প্রথম বুটে ডাটাবেসে), `dashboard/src/data/seed.ts` ও `mobile/src/lib/seed.ts` (নমুনা মোডে) একই গল্প বলে, যাতে দুই মোডে একই জিনিস দেখা যায়: দুটো মাঠ (`field-tomato` জোন ক, `field-brinjal` জোন গ), দুই মাসের আয়-খরচ (সব মাঠে ট্যাগ করা, কয়েকটা ট্যাগ ছাড়া), পোকা-রোগের নোট মাঠসহ, শেষ তারিখ ও পুনরাবৃত্তিসহ কাজ (একটা দেরি হওয়া), কম মজুত, বাজারদর। শুধু ব্যাকএন্ডে বাড়তি আছে ফলনের খাতা (৩ বার টমেটো তোলা, বিক্রির এন্ট্রির সাথে মেলানো) ও গত ১৪ দিনের সকালের সেচ (`PumpRun`, ৫০০ লিটার করে) — তাই লিটার-প্রতি-কেজি ও ফলনের হিসাব শুধু লাইভ মোডে আসে। একটায় বদলালে বাকি দুটোও বদলান। ড্যাশবোর্ডের পুরোনো সংরক্ষিত নমুনা ডেটা নতুন seed পাবে না — সেটিংসের "নমুনা রিসেট" চাপুন।

## নতুন পেজ যোগ করা

1. `src/types.ts`-এ `ViewId`-তে নতুন আইডি।
2. `src/lib/nav.ts`-এ নেভিগেশনের এন্ট্রি (আইকন, নাম, উপশিরোনাম)।
3. `src/pages/<নাম>/<নাম>-page.tsx` বানান।
4. `src/App.tsx`-এর `PAGES` ম্যাপে যোগ করুন।

## নতুন ডেটা বা অ্যাকশন

1. `types.ts`-এ টাইপ।
2. `data/seed.ts`-এ প্রাথমিক মান।
3. `atoms/farm.ts`-এ অ্যাকশন।
4. ডেটার গড়ন বদলালে localStorage-এর কী (`farm-command-v1`) বদলে দিন, নইলে পুরোনো সংরক্ষিত ডেটার সঙ্গে গোলমাল হবে (`atoms/farm.ts` নতুন ফিল্ডের জন্য seed-এর ডিফল্ট বসিয়ে দেয়)।

## চার্ট যোগ করা

`EChart` কম্পোনেন্টে `option` দিন। আলাদা অংশ ব্যবহার করলে `echarts/core`-এ রেজিস্টার করতে হবে (`src/components/echart.tsx`)।

```tsx
<EChart option={option} label="চার্টের বর্ণনা" height={280} />
```

`label` স্ক্রিন রিডারের জন্য। `option` `useMemo` দিয়ে রাখুন, নইলে প্রতি টিকে চার্ট নতুন করে আঁকা হবে।

## সিমুলেটর থেকে আসল ডেটায় (এখন চালু)

- **দুই ধরনের অবস্থা:** jotai-তে শুধু গ্লোবাল অবস্থা (সেচ নিয়ন্ত্রণ, নমুনা ডেটা ও সিমুলেটর, auth)। পেজের লিস্ট ডেটা (কাজ, মাঠ, খাতা, আয়-খরচ, মজুত, সময়সূচি, ডিভাইস) TanStack Query-র — হুকগুলো `src/services/`-এ।
- `services/source.ts`-এর `useList`/`useMutate` সোর্স বাছাই করে: সার্ভার যুক্ত থাকলে REST, নমুনা মোডে ডেমো স্টোর। সফল মিউটেশনে কী invalidate হয়।
- `use-simulator` নমুনা মোডে প্রতি ২ সেকেন্ডে স্টোরের `tick()` চালায়।
- `use-live-farm` নমুনা মোড বন্ধ থাকলে প্রতি ৫ সেকেন্ডে `GET /api/v1/farm` এনে স্টোর `hydrate()` করে (নিয়ন্ত্রণ + ওভারভিউ/সাইডবারের মিরর); নমুনা ↔ লাইভ বদলালে সব কোয়েরি ক্যাশ ফেলে দেয়। API না পেলে নীরবে চেষ্টা চালিয়ে যায়। লগইন ছাড়া লাইভ চলে না — নমুনা মোড বন্ধ + সেশন নেই মানে লগইন স্ক্রিন (`App.tsx`-এর রুট গার্ড), ৪০১ পেলে `http.ts` সেশন ফেলে দেয়।
- নিয়ন্ত্রণের অ্যাকশন (পাম্প, ভালভ, মোড, নিয়ম) লাইভে আগে API-তে কমান্ড পাঠায়, সার্ভারের ফেরত আসা অবস্থায় স্টোর বদলায় — আশাবাদী আপডেট নয়, কারণ পাম্প আসল জিনিস।
- ডিভাইস (বা সিমুলেটর) সরাসরি `POST /api/v1/telemetry`-তে ডেটা পাঠায়; MQTT ব্রিজ পরে আসবে।
- সময়সূচি, নিয়ম ও অটো মোড সার্ভারের নিয়ম ইঞ্জিনে চলে (`backend/internal/engine`); লাইভ মোডে ক্লায়েন্টের `tick()` বন্ধ, নমুনা মোডে শুধু সেটাই চলে।
- ওভারভিউ ও বিশ্লেষণের চার্ট লাইভে টেলিমেট্রি থেকে (`pages/analytics/derive.ts`), নমুনা মোডে `data/demo-series.ts`-এর নমুনায়।

## নতুন API এন্ডপয়েন্ট যোগ করা

1. `backend/internal/models/`-এ মডেল (JSON ট্যাগ ড্যাশবোর্ডের টাইপের সাথে মিলিয়ে)।
2. `backend/internal/api/`-এ হ্যান্ডলার, `router.go`-তে রুট — ডিভাইস-প্রোটোকল না হলে `authed` গ্রুপে (টোকেন লাগবে); লেখার রুট `oper` বা `owner` গ্রুপে।
3. `dashboard/src/services/`-এ টাইপ করা ফাংশন ও `source.ts`-এর সাহায্যে `useList`/`useMutate` হুক; পেজ সেই হুক থেকে ডেটা পড়বে।
4. লিস্ট এন্ডপয়েন্ট হলে `paging.go`-র `parsePaging`/`search`/`respondPaged` দিয়ে `?q=&page=&limit=` ও ফিল্টার দিন — সব লিস্ট `Page` খামে (`{items,total,page,limit,pages}`) সাড়া দেয়।

# মোবাইল অ্যাপ

```bash
cd mobile
npm install
npx expo start                # Expo Go / এমুলেটরে চালান
npx tsc --noEmit              # টাইপচেক
npx expo-doctor               # ডিপেন্ডেন্সি পরীক্ষা
npx expo export --platform android   # বান্ডল স্মোক টেস্ট
```

- রুট `src/app/`-এ expo-router দিয়ে ফাইলভিত্তিক: `(tabs)/`-এ ৫টা ট্যাব (ওভারভিউ, সেচ, মাঠ, কাজ, আরও), বাকি পাতা স্ট্যাকে।
- `state/farm.ts` ড্যাশবোর্ডের `atoms/farm.ts`-এর যমজ — jotai স্টোরে ফার্মের কন্ট্রোল (পাম্প, ভালভ, নিয়ম) ও নমুনা ডেটা; AsyncStorage-এ সংরক্ষিত (কী: `farm-command-mobile-v1`)। স্টোরের গড়ন বদলালে কী বদলে দিন।
- `src/services/` ড্যাশবোর্ডের `services/`-এর যমজ — TanStack Query হুক (`source.ts`-এর `useList`/`useMutate`: লাইভে REST, নমুনা মোডে ডেমো স্টোর); লিস্ট ডেটা (কাজ, মাঠ, খাতা, আয়-খরচ, মজুত, সময়সূচি, ডিভাইস, টেলিমেট্রি) এখান থেকেই আসে। API বদলালে তিন জায়গায় (backend, dashboard, mobile) মিলিয়ে রাখুন।
- `state/conn.ts`-এ সার্ভারের ঠিকানা, লগইন সেশন ও নমুনা মোড; মোড বদলালে পুরো কোয়েরি ক্যাশ ফাঁকা হয়। কানেক্ট স্ক্রিনে ঠিকানার সাথে ইমেইল-পাসওয়ার্ড দিয়ে লগইন (`connectServer`), ৪০১ পেলে ইঞ্জিন আবার কানেক্ট স্ক্রিনে ফেরায়। `state/engine.ts` লাইভ পোলিং (৫ সেকেন্ড, ব্যর্থ হলে ১৫) আর নমুনা টিক (৩ সেকেন্ড) চালায়।
- কন্ট্রোল অ্যাকশনের নিয়ম একই: লাইভে আগে API, সার্ভারের স্ন্যাপশট ফিরলে স্টোর বদলায়; লিস্ট মিউটেশন কোয়েরি হুকে, সফল হলে কী invalidate হয়।
- সব ফর্ম ড্যাশবোর্ডের মতোই react-hook-form-এ (`useForm` + `Controller`): টেক্সট ইনপুট, ChoiceChips ও সুইচ সবই Controller-এ, ভ্যালিডেশনের বার্তা বাংলায় ফিল্ডের নিচে (`FieldError`), বাংলা অঙ্ক `toNum` দিয়ে, জমা দিলে `reset()`।
- চার্ট `react-native-svg`-তে হাতে আঁকা (`components/charts.tsx`); বিশ্লেষণ পাতায় লাইভ মোডে `/api/v1/telemetry` থেকে।

## কোড স্টাইল

- TypeScript কড়া মোডে, অব্যবহৃত ভ্যারিয়েবল এরর।
- রঙ সরাসরি না লিখে `index.css`-এর টোকেন (`success`, `warning`, `danger`, `info`, সাইডবারের `sidebar-*`, হাইলাইটের `gold`) ব্যবহার করুন। নতুন পেজে মূল সংখ্যার জন্য `StatTile`, কার্ডের জন্য `Panel` বা আইকনসহ `CardTitle` নিন, যাতে চেহারা মেলে।
- UI-র লেখা সরাসরি কোডে না লিখে `src/i18n/{bn,en}.json`-এ কী বসিয়ে `t('key')` (উপরের "ভাষা" অংশ)। ব্যতিক্রম: সার্ভারে জমা ডেটা ও কিছু তালিকা (যেমন সেটিংসের `ROADMAP`) এখনো বাংলায় কোডে।

## পরীক্ষা

- `dashboard`: vitest — `src/lib/farm.test.ts`-এ সতর্কতা, সুপারিশ ও ফসলের ধাপের যুক্তির টেস্ট (`npm run test`)।
- `backend`: `go test ./...` — ডাটাবেস-ভিত্তিক টেস্ট `TEST_DATABASE_URL` সেট থাকলে চলে (না থাকলে skip); প্রতিটা প্যাকেজ নিজের schema-য় চলে (`internal/testutil`), তাই প্যাকেজগুলো সমান্তরালে চললেও একে অপরের ডেটা মোছে না। `internal/api/api_test.go` (লগইন, ভূমিকা, ফার্ম স্ন্যাপশট, ফিল্টার ও পেজিং), `features_test.go` (কাজের তারিখ ও পুনরাবৃত্তি, মজুত ব্যবহার, মাঠ সম্পাদনা, ফসল টেমপ্লেট ও পরামর্শ, বাজারদর, সাপ্তাহিক সারসংক্ষেপ, অফলাইন রিপ্লে), `admin_test.go` (সতর্কতা, অডিট, ডিভাইস-চাবি ও কমান্ড, একসাথে মজুত খরচ, ব্যবহারকারী), `routes_test.go` ও `client_contract_test.go` (ডাটাবেস ছাড়া — দুই ক্লায়েন্টের `services/*.ts`-এর প্রতিটা API কল সার্ভারের আসল রুটের সাথে মেলে কি না), `internal/engine` (Step, দৈনিক সীমা, সময়সূচি), `alerts`, `crops`, `recommend`, `report`, `notify`, `water`, `sensors`, `bangla`। নতুন এন্ডপয়েন্টে একই ধাঁচে টেস্ট যোগ করুন; ডাটাবেস চালাতে `.env.example`-এর শেষ অংশ দেখুন।
- `mobile`: `npm test` — অফলাইন আউটবক্সের খাঁটি যুক্তি (`src/lib/outbox.test.ts`, Node 22.18+ লাগে, বাড়তি প্যাকেজ নয়)।
- `mobile`: `npx tsc --noEmit` ও `npx expo-doctor`; বিল্ডের আগে `npx expo export --platform android` দিয়ে বান্ডল পরীক্ষা।
- বিল্ডের আগে `npx tsc -b`, `npm run lint` ও দুই পাশের টেস্ট চালান।
