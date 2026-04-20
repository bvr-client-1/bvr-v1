# BVR Deployment Guide

## Frontend: Vercel

This project is now a Next.js App Router frontend and is ready for Vercel.

Vercel settings:

```text
Framework Preset: Next.js
Install Command: npm install
Build Command: npm run build
Output Directory: .next
```

Required Vercel environment variables:

```text
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_replace_me
NEXT_PUBLIC_APP_NAME=BVR Restaurant
NEXT_PUBLIC_FRONTEND_URL=https://your-vercel-domain.vercel.app
NEXT_PUBLIC_RESTAURANT_LAT=17.0654277
NEXT_PUBLIC_RESTAURANT_LNG=79.2686857
NEXT_PUBLIC_DELIVERY_RADIUS_KM=6
NEXT_PUBLIC_FREE_DELIVERY_ENABLED=true
NEXT_PUBLIC_FREE_DELIVERY_COUPON_CODE=FREEDEL
API_PROXY_TARGET=https://your-express-backend-domain.com
```

`API_PROXY_TARGET` must point to the deployed Express backend origin without `/api`.

Example:

```text
API_PROXY_TARGET=https://bvr-api.onrender.com
```

The frontend will call:

```text
/api/orders/create-order
```

Next will proxy it to:

```text
https://bvr-api.onrender.com/api/orders/create-order
```

## Backend: Express Host

The Express backend remains unchanged. Deploy it on a Node host such as Render, Railway, Fly.io, or a VPS.

This repo includes a Render blueprint:

```text
render.yaml
```

On Render, create a Blueprint from the repo, then fill the `sync: false` environment variables in the Render dashboard.

Backend start command:

```text
npm run backend
```

Required backend environment variables:

```text
PORT=4000
FRONTEND_URL=https://your-vercel-domain.vercel.app
FRONTEND_URLS=https://your-vercel-domain.vercel.app
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace_me
RAZORPAY_KEY_ID=rzp_live_replace_me
RAZORPAY_KEY_SECRET=replace_me
JWT_SECRET=replace_me_with_a_very_long_random_secret_min_32_chars
OWNER_EMAIL=owner@bvr.com
OWNER_PASSWORD_HASH=replace_with_bcrypt_hash
KITCHEN_LOGIN_ID=replace_with_kitchen_login_id
KITCHEN_PASSWORD_HASH=replace_with_bcrypt_hash
GOOGLE_PLACES_API_KEY=replace_with_google_places_api_key
GOOGLE_PLACE_ID=replace_with_google_place_id
RESTAURANT_LAT=17.0654277
RESTAURANT_LNG=79.2686857
DELIVERY_RADIUS_KM=6
FREE_DELIVERY_ENABLED=true
FREE_DELIVERY_COUPON_CODE=FREEDEL
RAZORPAY_WEBHOOK_SECRET=replace_me_with_razorpay_webhook_secret
SUPABASE_KEEPALIVE_INTERVAL_HOURS=48
REVIEW_SYNC_INTERVAL_HOURS=24
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=500
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=20
```

Before going live, run the Supabase migration:

```text
supabase/migrations/2026-04-07_payment_and_pending_storage.sql
```

This creates:

```text
payment_records
pending_order_drafts
```

Those tables are now the intended production storage for refund/payment metadata and pending payment drafts.

## Razorpay

Set Razorpay webhook URL to:

```text
https://your-express-backend-domain.com/api/webhooks/razorpay
```

Use the same secret in Razorpay Dashboard and `RAZORPAY_WEBHOOK_SECRET`.

Enable events:

```text
payment.captured
refund.created
refund.processed
refund.failed
```

## Pre-Deploy Checks

Run locally:

```powershell
npm test
npm run build
```

After setting production environment variables locally or in your host, run:

```powershell
npm run deploy:check
```

Do not deploy with placeholder or localhost values in production environment variables.
