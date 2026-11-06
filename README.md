# اليورو (Al-Euro) — Auto spare-parts platform

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase. Arabic RTL, dark/light themes.

## Deploy (once)
1. Supabase -> SQL editor -> run **`supabase/admin_full_setup.sql`**. Before the last statement, replace `09XXXXXXXX` with the phone of a registered **marketer** account to promote it to `admin`.
2. Then run **`supabase/loyalty_cashback_2026_10.sql`** to enable the 90-day loyalty season and server-side cashback. Run this after the base setup.
3. Then run **`supabase/migrations/20261106140000_euro_final_loyalty_vip_15_percent.sql`** to apply the final 90-day tiers: Standard 0%, Bronze 2%, Silver 5%, Gold 7%, Platinum 10%, and VIP 15%.
3. Set the environment variables from `.env.example` (Render: Environment tab).
4. Build `npm install && npm run build`, start `npm start`.
5. Sign in at `/admin/login` with the promoted account.

## Admin dashboard (`/admin`)
| Route | Purpose |
| --- | --- |
| `/admin` | KPIs, branch stock breakdown, low-stock alerts |
| `/admin/accounts` | Activate / suspend workshops & marketers, automatically calculated loyalty tier (Standard/Bronze/Silver/Gold/Platinum/VIP), cashback balance and debt limit |
| `/admin/payments` | Sham Cash receipt queue (zoomable receipt, approve / reject with reason) |
| `/admin/orders` | Filterable orders, detail drawer, one-click status, `/admin/orders/[id]/print` invoice & packing slip |
| `/admin/requests` | VIN / special requests: quote, reply, status |
| `/admin/ledger` | Workshop debt balances, ledger history, record repayments |
| `/admin/parts` | Parts CRUD, inline price/stock, image upload |
| `/admin/commissions` | 2% marketer commissions: held / available / paid |

All writes that touch several tables (order approval/cancel/delivery, debt repayment, commission payout) run
inside Postgres functions (`admin_*`) so they are atomic. Only the server (service role) can execute them.

## Notes
- DB values are fixed by CHECK constraints; the TypeScript mirror is `lib/status.ts`.
- The admin's reply to a special request is stored inside `special_requests.notes` after the marker
  `[ملاحظة الإدارة]` (no extra column); the customer sees it under "طلباتي الخاصة" in their account.
- `orders.status_note` holds the rejection / cancellation reason shown to the customer under "طلباتي".


## Firebase push notifications

The server-side push delivery branch uses these Render environment variables (all server-only):
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (paste the rotated service-account private key; keep its newline formatting)
- `CRON_SECRET` (random secret used by the scheduled debt reminder endpoint)

Apply the two SQL migrations in `supabase/migrations/` in timestamp order before deploying:
- `20261101130000_add_push_tokens.sql`
- `20261101130100_add_user_notifications_and_fcm.sql`

The app registers device tokens at sign-in, refreshes them when FCM rotates them, unregisters them on sign-out, shows foreground notifications, and routes notification taps to the relevant app section. Server events persist each notification once before attempting FCM delivery.

For debt reminders, create a daily Render Cron Job that sends:
`GET https://al-euro-cdzo.onrender.com/api/cron/debt-reminders`
with header `Authorization: Bearer <CRON_SECRET>`. It sends one reminder when a workshop is 25–30 days from its latest debit entry.

Admin operational announcements (maintenance, release notes and important messages) can be sent through `POST /api/admin/notifications` using an admin session. This endpoint is restricted to active workshops and marketers; it is not a marketing broadcast channel.
