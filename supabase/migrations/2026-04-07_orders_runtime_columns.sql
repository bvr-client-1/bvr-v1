alter table public.orders
  add column if not exists rejection_reason text,
  add column if not exists cook_started_at timestamptz;
