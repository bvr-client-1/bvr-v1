create table if not exists public.order_audit_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid null,
  event_type text not null check (event_type in ('ITEM_REMOVED', 'ORDER_CANCELLED')),
  actor_role text null,
  actor_id text null,
  item_name text null,
  quantity_removed integer null,
  unit_price numeric(10,2) null,
  line_total numeric(10,2) null,
  consent_status text not null default 'UNKNOWN' check (consent_status in ('WITH_CONSENT', 'WITHOUT_CONSENT', 'UNKNOWN')),
  note text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_audit_events_order_id_idx on public.order_audit_events(order_id, created_at desc);
