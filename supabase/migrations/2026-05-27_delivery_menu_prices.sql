alter table public.menu_items
  add column if not exists delivery_price numeric(10,2);

update public.menu_items
set delivery_price = round((price * 1.20)::numeric, 2)
where delivery_price is null
  and price is not null;
