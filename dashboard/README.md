# ফার্ম কমান্ড

ছোট ও মাঝারি কৃষকের জন্য একটা স্মার্ট ফার্মিং ড্যাশবোর্ড। সেচ নিয়ন্ত্রণ, মাঠ ও ফসলের হিসাব, বিশ্লেষণ, কাজ, আয়-খরচ, মজুত আর ডিভাইসের অবস্থা এক জায়গায়।

Smart farming command center: irrigation control, field and crop tracking, analytics, tasks, finance, inventory and device status in one dashboard. The UI is in Bangla, with an English translation.

> নমুনা মোডে ড্যাশবোর্ড সিমুলেটর আর localStorage-এ চলে, লগইন লাগে না। নমুনা মোড বন্ধ করলে লগইন স্ক্রিন আসে (ডেমো: owner@farm.com / farm123), তারপর সার্ভারের (`../backend`) আসল ডেটায় চলে — তখন পাম্প বা সেচের কমান্ডও API-তে যায়। আসল সেন্সর ও পাম্পের সংযোগ (ESP32, MQTT) এখনো বাকি। প্রকল্পের অবস্থা: [../docs/README.md](../docs/README.md)।

## চালানো

```bash
npm install
npm run dev
```

অন্য কমান্ড: `npm run build`, `npm run lint`, `npm run test`, `npm run preview`।

ডেভ সার্ভারের `/api` স্বয়ংক্রিয়ভাবে `http://localhost:8000`-এ যায় (`vite.config.ts`-এর প্রক্সি), তাই পাশাপাশি `../backend`-এ `go run ./cmd/server` চালু থাকলেই আসল API পাওয়া যায়। আলাদা ঠিকানা দরকার হলে `.env.example` দেখুন।

পুরো সিস্টেম (PostgreSQL + API, ড্যাশবোর্ডও একই Go সার্ভার থেকে) এক কমান্ডে:

```bash
docker compose up -d --build   # রিপোর রুট থেকে; অ্যাপ → http://localhost:8082
```

## প্রযুক্তি

- Vite, React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui ধাঁচের কম্পোনেন্ট (Radix UI, class-variance-authority, lucide-react, sonner)
- Apache ECharts (চার্ট)
- jotai (সব গ্লোবাল অবস্থা: ফার্মের নিয়ন্ত্রণ, সিমুলেটর, auth — `src/atoms/`)
- TanStack Query (API কল), react-hook-form (ফর্ম), vitest (ইউনিট টেস্ট)
- i18next + react-i18next (বাংলা/ইংরেজি — `src/i18n/`)

## ফোল্ডার

```
src/
  components/   শেয়ার করা কম্পোনেন্ট ও ui/
  pages/        overview, irrigation, fields, analytics, tasks, finance, reports, inventory, devices, settings, login
  services/     API কল ও TanStack Query হুক (লাইভ ডেটার পোলিংও এখানে — farm.ts)
  atoms/        jotai অ্যাটম (farm.ts — ফার্মের ডেটা ও অ্যাকশন, auth.ts)
  data/         নমুনা ডেটা
  lib/          সহায়ক ফাংশন
  hooks/        নমুনা মোডের সিমুলেটর
  i18n/         ভাষার ফাইল (bn.json, en.json)
```

## ডিভাইস যুক্ত করা

ESP32 বা যেকোনো বোর্ড `POST /api/v1/telemetry`-এ JSON পাঠালেই ডেটা ড্যাশবোর্ডে আসে। ফরম্যাট ও চাবির নিয়ম: [../docs/05-device-protocol.md](../docs/05-device-protocol.md)। MQTT ব্রিজ এখনো নেই।
