create extension if not exists pgcrypto;

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique,
  order_code text unique,
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  amount integer,
  payment_status text,
  refund_id text,
  refund_amount integer,
  refund_status text,
  refund_failure_reason text,
  refund_initiated_at timestamptz,
  refund_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_records_updated_at_idx on public.payment_records (updated_at desc);
create index if not exists payment_records_order_id_idx on public.payment_records (order_id);
create index if not exists payment_records_order_code_idx on public.payment_records (order_code);
create index if not exists payment_records_razorpay_order_id_idx on public.payment_records (razorpay_order_id);
create index if not exists payment_records_razorpay_payment_id_idx on public.payment_records (razorpay_payment_id);

create table if not exists public.pending_order_drafts (
  razorpay_order_id text primary key,
  amount integer not null,
  receipt text not null,
  draft jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_order_drafts_created_at_idx on public.pending_order_drafts (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payment_records_set_updated_at on public.payment_records;
create trigger payment_records_set_updated_at
before update on public.payment_records
for each row
execute function public.set_updated_at();

drop trigger if exists pending_order_drafts_set_updated_at on public.pending_order_drafts;
create trigger pending_order_drafts_set_updated_at
before update on public.pending_order_drafts
for each row
execute function public.set_updated_at();
