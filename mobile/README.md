# ফার্ম কমান্ড — মোবাইল অ্যাপ (Expo / React Native)

ফার্ম কমান্ডের অ্যান্ড্রয়েড ও iOS অ্যাপ। ড্যাশবোর্ডের মতোই সবকিছু বাংলায়: সেচ নিয়ন্ত্রণ, মাঠ ও ফসল,
বিশ্লেষণ, কাজ, হিসাব, মজুত আর ডিভাইসের অবস্থা — সাথে একটা "নমুনা মোড" যা সার্ভার ছাড়াই চলে।

The Farm Command mobile app (React Native + Expo). It mirrors the dashboard's
pages (all but the printable reports page) in Bangla, talks to the same Go
backend, queues writes made offline, and ships a demo mode that runs entirely
on-device.

## চালানো

```bash
cd mobile
npm install
npx expo start        # তারপর Expo Go অ্যাপে QR স্ক্যান করুন, বা a/i চাপুন (এমুলেটর)
```

সার্ভারের সাথে যুক্ত করতে অ্যাপ প্রথমবার খুললেই ঠিকানা আর লগইন (ইমেইল-পাসওয়ার্ড, ডেমো: owner@farm.com / farm123; সার্ভারে `GOOGLE_CLIENT_ID` থাকলে Google) চাইবে:

| কোথায় চালাচ্ছেন | কী দেবেন |
|---|---|
| একই নেটওয়ার্কের কম্পিউটারে `docker compose up` | `http://<কম্পিউটারের-আইপি>:8082` |
| অ্যান্ড্রয়েড এমুলেটরে (সার্ভার হোস্টে) | `http://10.0.2.2:8082` |
| iOS সিমুলেটরে (সার্ভার হোস্টে) | `http://localhost:8082` |

সার্ভার না থাকলে **নমুনা মোডে দেখুন** — ডেমো ডেটা ও সিমুলেটর ফোনেই চলবে। সেটিংস থেকে যখন
খুশি সার্ভার বদলানো বা নমুনা মোডে ফেরা যায়।

## পরীক্ষা ও বিল্ড

```bash
npx tsc --noEmit     # টাইপচেক
npm test             # অফলাইন আউটবক্সের যুক্তি (node:test)
npx expo lint        # ESLint
npx expo-doctor      # ডিপেন্ডেন্সির স্বাস্থ্য পরীক্ষা
npx expo export --platform android   # বান্ডল স্মোক টেস্ট
```

APK/IPA বানাতে [EAS Build](https://docs.expo.dev/build/introduction/) বা লোকাল
`npx expo run:android` / `npx expo run:ios` (নেটিভ টুলচেইন লাগবে)। আইকন-স্প্ল্যাশ এখনো Expo-র
ডিফল্ট — `assets/images/`-এ নিজের ছবি বসিয়ে নিন (Android, iOS ও ওয়েব সবাই এখান থেকেই নেয়)।

## ভেতরের গড়ন

```
mobile/
  app.json                     অ্যাপের নাম, থিম (হালকা সবুজ), স্প্ল্যাশ
  src/
    app/                       expo-router রুট
      _layout.tsx              রুট স্ট্যাক + ইঞ্জিন + টোস্ট
      connect.tsx              প্রথম স্ক্রিন: সার্ভারের ঠিকানা + লগইন / নমুনা মোড
      (tabs)/                  নিচের ৫টা ট্যাব — ওভারভিউ, সেচ, মাঠ, কাজ, আরও
      analytics|finance|inventory|devices|settings.tsx   বাকি পাতাগুলো
    lib/
      types.ts                 ড্যাশবোর্ডের types.ts-এর মিরর (API-র JSON ট্যাগের সাথে মেলে)
      farm.ts / format.ts      সতর্কতা-সুপারিশ ও বাংলা অঙ্কের হেল্পার (ড্যাশবোর্ড থেকে পোর্ট)
      seed.ts                  নমুনা মোডের ডেটা (backend/internal/db/seed.go-এর মিরর)
      theme.ts                 ড্যাশবোর্ডের CSS ভেরিয়েবলের রঙ
    services/                  TanStack Query-ভিত্তিক API স্তর — ড্যাশবোর্ডের services/-এর যমজ
      http.ts                  টাইপ করা fetch র‍্যাপার (বেস URL কানেক্ট স্ক্রিন থেকে)
      source.ts                useList/useMutate — লাইভে REST, নমুনা মোডে ডেমো স্টোর
      farm.ts                  ফার্ম কন্ট্রোল API + টেলিমেট্রির কোয়েরি হুক
      tasks|fields|finance|inventory|schedules|devices|harvest|advice|alerts|reports|weather|safety.ts   রিসোর্স অনুযায়ী হুক
    state/
      farm.ts                  jotai স্টোর — ফার্ম কন্ট্রোল + নমুনা ডেটা ও অ্যাকশন
      conn.ts                  সার্ভারের ঠিকানা ও নমুনা মোড (AsyncStorage-এ), লগইন সেশন (টোকেন জোড়া, SecureStore/কিচেইনে)
      outbox.ts                অফলাইন আউটবক্স — নেট না থাকলে লেখা জমায়, নেট এলে ক্রমে পাঠায় (যুক্তি lib/outbox.ts-এ)
      engine.ts                লাইভ পোলিং (৫সে/১৫সে) + নমুনা টিক (৩সে)
      toast.ts                 sonner-এর বদলে ছোট ইন-অ্যাপ টোস্ট
    components/                UI কিট (কার্ড, বাটন, ব্যাজ, চিপ, StatTile) ও SVG চার্ট
```

- **ডেটা:** সার্ভার যুক্ত থাকলে `GET /api/v1/farm`-এর কন্ট্রোল স্ন্যাপশট প্রতি ৫ সেকেন্ডে আসে; লিস্ট ডেটা
  (কাজ, মাঠ, খাতা, আয়-খরচ, মজুত, সময়সূচি, ডিভাইস, টেলিমেট্রি) TanStack Query-র হুকে আসে
  (`src/services/`)। নমুনা মোডে একই হুক ডেমো স্টোর থেকে পড়ে; মোড বদলালে কোয়েরি ক্যাশ ফাঁকা হয়।
- **নমুনা মোড:** ডেমো ডেটা ও সিমুলেটর ফোনেই চলে — ড্যাশবোর্ডের "নমুনা মোড"-এর মতোই।
- **চার্ট:** ECharts-এর বদলে `react-native-svg` দিয়ে আঁকা লাইন/বার চার্ট; বিশ্লেষণ পাতায়
  লাইভ মোডে `/api/v1/telemetry`-র আসল ডেটা দেখায়।
- **ফন্ট:** ড্যাশবোর্ডের সাথে মিলিয়ে Hind Siliguri।

## ডিভাইস/সিমুলেটর থেকে ডেটা

ব্যাকএন্ড একই: [docs/05-device-protocol.md](../docs/05-device-protocol.md) দেখুন — মোবাইল অ্যাপ
শুধু রিডার, ডেটা পাঠায় না।
