# اليورو (Al-Euro) — Auto spare-parts platform

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase. Arabic RTL, dark/light themes.

## Deploy (once)
1. Supabase -> SQL editor -> run **`supabase/admin_full_setup.sql`** (idempotent, safe to re-run).
   Before the last statement, replace `09XXXXXXXX` with the phone of a registered **marketer** account
   to promote it to `admin`.
2. Set the environment variables from `.env.example` (Render: Environment tab).
3. Build `npm install && npm run build`, start `npm start`.
4. Sign in at `/admin/login` with the promoted account.

## Admin dashboard (`/admin`)
| Route | Purpose |
| --- | --- |
| `/admin` | KPIs, branch stock breakdown, low-stock alerts |
| `/admin/accounts` | Activate / suspend workshops & marketers, tier (Bronze/Silver/Gold), debt limit |
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
