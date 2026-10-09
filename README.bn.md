# ফার্ম কমান্ড (Farm Command)

[English README](README.md)

ছোট ও মাঝারি কৃষকের জন্য স্মার্ট ফার্মিং সিস্টেম: সেচ নিয়ন্ত্রণ, মাঠ ও ফসলের হিসাব, বিশ্লেষণ, কাজ, আয়-খরচ, মজুত আর ডিভাইসের অবস্থা এক জায়গায়। ইন্টারফেস বাংলায়।

A smart-farming stack for small farms: irrigation control, field and crop tracking, analytics, tasks, finance, inventory and device status. The UI is in Bangla.

## রিপোর কাঠামো

```
backend/     Go + Gin + PostgreSQL (TimescaleDB)-এর REST API — টেলিমেট্রি গ্রহণ, সেচ নিয়ন্ত্রণ,
             মাঠ/কাজ/আয়-খরচ/মজুতের সব CRUD; প্রথম বুটে ডেমো ডেটা বসায়
dashboard/   React + Vite + Tailwind-এর ড্যাশবোর্ড (১০টা পেজ, ECharts চার্ট)
mobile/      Expo / React Native অ্যাপ (Android ও iOS) — একই API, বাংলা UI,
             সার্ভার ছাড়া চলার "নমুনা মোড"সহ; [mobile/README.md](mobile/README.md)
docs/        পরিকল্পনা ও ডকুমেন্টেশন (বাংলায়) — [docs/README.md](docs/README.md) থেকে পড়ুন
```

ড্যাশবোর্ডের "নমুনা মোড" চালু থাকলে সিমুলেটর চলে (ডেটা ব্রাউজারেই থাকে)। বন্ধ করলে ড্যাশবোর্ড
সার্ভারের সাথে যুক্ত হয়ে API-র আসল ডেটা দেখায় আর সব কমান্ড (পাম্প, ভালভ, সেচ, কাজ, খরচ…) সার্ভারে
পাঠায় — সার্ভার নিশ্চিত করলে তবেই অবস্থা বদলায়।

## এক কমান্ডে পুরো সিস্টেম (Docker)

```bash
git clone https://github.com/zulkar29/agri-command-center.git
cd agri-command-center
cp .env.example .env   # ঐচ্ছিক; লোকাল ডেমোর বাইরে হলে JWT_SECRET দিন
docker compose up -d --build
```

| কী | ঠিকানা |
|---|---|
| ড্যাশবোর্ড ও API (একই পোর্ট) | http://localhost:8082 |
| Adminer (ডাটাবেস) | http://localhost:8083 |

PostgreSQL (TimescaleDB এক্সটেনশনসহ) আর একটাই Go কন্টেইনার — Go সার্ভার নিজেই `/api` আর ড্যাশবোর্ড দুটোই এক পোর্টে দেয়
(nginx নেই)। প্রথম বুটে ডেমো ফার্ম ও ৭ দিনের টেলিমেট্রি ইতিহাস বসে। ডিফল্ট পোর্টগুলো (৮০৮২/৮০৮৩/৫৪৩৩)
ভিড়ের ৮০৮০/৫৪৩২ এড়িয়ে বেছে নেওয়া; পাসওয়ার্ড বা পোর্ট বদলাতে `.env.example` দেখুন।

ড্যাশবোর্ডে ঢুকতে লগইন লাগে (নমুনা মোড বন্ধ করলেই লগইন স্ক্রিন আসে)। ডেমো অ্যাকাউন্ট (পাসওয়ার্ড সবগুলোর
**farm123**): **owner@farm.com** (মালিক), **baba@farm.com** (অপারেটর), **guest@farm.com** (দর্শক) —
ভূমিকা অনুযায়ী লেখার অনুমতি সার্ভারেই কার্যকর।
API-ও একই JWT চায় — `POST /api/v1/auth/login` দিয়ে টোকেন নিয়ে `Authorization: Bearer <টোকেন>`
হেডারে পাঠান; মেয়াদ শেষ হলে `POST /api/v1/auth/refresh` (বিস্তারিত docs/08-developer-guide.md)।
চাইলে `.env`-এ `GOOGLE_CLIENT_ID` দিয়ে "Google দিয়ে লগইন" চালু করা যায় (সেটআপ `.env.example`-এ)।

## আলাদা করে চালানো (ডেভেলপমেন্ট)

```bash
# ১) ডাটাবেস (শুধু প্রথমবার দরকার)
docker compose up -d db

# ২) API — http://localhost:8000
cd backend && go run ./cmd/server

# ৩) ড্যাশবোর্ড — http://localhost:5173 ( /api স্বয়ংক্রিয়ভাবে :8000-এ যায়)
cd dashboard && npm install && npm run dev

# ৪) মোবাইল অ্যাপ — Expo Go-তে QR স্ক্যান করুন, সার্ভারের ঠিকানা দিন (বা নমুনা মোড)
cd mobile && npm install && npx expo start
```

## ডিভাইস থেকে ডেটা পাঠানো

MQTT ব্রিজ এখনো নেই; আপাতত ডিভাইস (বা সিমুলেটর) সরাসরি HTTP-তে পাঠাতে পারে — ফরম্যাট
[docs/05-device-protocol.md](docs/05-device-protocol.md)-এ:

```bash
curl -X POST http://localhost:8082/api/v1/telemetry \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Key: dev-key-sensor-1' \
  -d '{"farm":"my-farm","node":"esp32-field-1","soil_moisture":[44,38,31],
       "air_temp":28,"air_humidity":78,"tank_level":68,"battery_v":12.6}'
```

(ডকারে অ্যাপের পোর্ট `APP_PORT`-এ বদলানো থাকলে সেটাই ব্যবহার করুন। ডিভাইসের সারিতে চাবি
সেট করা থাকলে `X-Device-Key` হেডার লাগবে — ডেমো চাবি `dev-key-sensor-1`; খালি চাবির ডিভাইস
খোলা, বিস্তারিত [docs/05](docs/05-device-protocol.md)।)

পাঠানোর সাথে সাথে ফার্মের লাইভ অবস্থা (আর্দ্রতা, তাপমাত্রা, ট্যাংক, ব্যাটারি) হালনাগাদ হয়। রিডিংগুলো
TimescaleDB হাইপারটেবিলে জমা থাকে (৭ দিনের পুরোনো ডেটা কম্প্রেস হয়, `TELEMETRY_RETENTION_DAYS` দিলে
তার চেয়ে পুরোনো মুছে যায়); চার্টের জন্য গড় করা ডেটা `GET /api/v1/telemetry/buckets` থেকে
([docs/08-developer-guide.md](docs/08-developer-guide.md#টেলিমেট্রি-ও-timescaledb))।

## টেস্ট

```bash
cd backend && go test ./...        # Go টেস্ট (auth, অনুমতি, API হ্যান্ডলার; DB টেস্টে TEST_DATABASE_URL লাগে)
cd dashboard && npm run test       # vitest (সতর্কতা ও সুপারিশের যুক্তি)
cd mobile && npm test              # অফলাইন আউটবক্সের যুক্তি (node:test)
cd mobile && npx tsc --noEmit      # মোবাইলের টাইপচেক
```

## অবস্থা ও পরিকল্পনা

- [x] ১০ পেজের ড্যাশবোর্ড (রিপোর্টসহ), নমুনা ডেটা ও সিমুলেটর
- [x] ডাটাবেস ও REST API, ডকারে এক কমান্ডে চালানো
- [x] ড্যাশবোর্ড ↔ API: আসল ডেটা, পাম্প ও সেচের কমান্ড
- [x] মোবাইল অ্যাপ (Expo): একই API ও ফিচার, নমুনা মোড ও অফলাইন আউটবক্সসহ
- [x] লগইন ও ভূমিকা (JWT, Google ঐচ্ছিক), বাংলা/ইংরেজি ভাষা
- [x] সার্ভারে নিয়ম ইঞ্জিন (অটো সেচ, Duration শেষে বন্ধ, সময়সূচি, ট্যাংকের নিয়ম) — `backend/internal/engine`, ক্লায়েন্ট ছাড়াই চলে
- [x] সার্ভারে সতর্কতা (শুকনো জোন, ট্যাংক/ব্যাটারি/মজুত কম, ডিভাইস অফলাইন) + টেলিগ্রাম ও SMS, আবহাওয়া (Open-Meteo) ও বৃষ্টি-নিয়ম r1, CSV এক্সপোর্ট ও PDF রিপোর্ট (লাভ-ক্ষতি, করণীয়, যা শিখলাম), ব্যবহারকারী ও অডিট (মালিক), ডিভাইস চাবি
- [ ] PWA, ESP32 ফার্মওয়্যার, MQTT ব্রোকার ও ব্রিজ

পুরো রোডম্যাপ: [docs/06-roadmap.md](docs/06-roadmap.md)
