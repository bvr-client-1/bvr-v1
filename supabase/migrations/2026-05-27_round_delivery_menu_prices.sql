alter table public.menu_items
  add column if not exists delivery_price numeric(10,2);

update public.menu_items
set delivery_price = (ceil((price * 1.20) / 10) * 10)::numeric(10,2)
where price is not null;
