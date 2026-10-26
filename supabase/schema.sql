-- =====================================================================
-- MarketRecipe database  v1
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it ONCE on a new, empty project.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- helpers: who is calling? ----------------------------------
-- Staff are identified by their (verified) login email.
create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- ---------- tables ------------------------------------------------------
create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My Shop 我的店',
  address    text not null default '',
  hours      text not null default '',
  line_id    text not null default '',
  created_at timestamptz not null default now()
);

create table public.members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs on delete cascade,
  email      text not null check (email = lower(trim(email)) and email like '%@%'),
  role       text not null default 'staff' check (role in ('owner','staff')),
  name       text not null default '',
  created_at timestamptz not null default now(),
  unique (email)               -- one shop per person keeps things simple
);

-- these two run with owner rights so RLS policies can call them without loops
create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from members where email = my_email() limit 1
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = my_email() and role = 'owner')
$$;

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default public.my_org() references public.orgs on delete cascade,
  name_en       text not null default '',
  name_zh       text not null default '',
  photo_url     text not null default '',
  default_price integer not null default 0 check (default_price >= 0),
  active        boolean not null default true,
  sort          integer not null default 0,
  created_at    timestamptz not null default now()
);

create table public.markets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.my_org() references public.orgs on delete cascade,
  name       text not null,
  date       date not null,
  location   text not null default '',
  status     text not null default 'upcoming' check (status in ('upcoming','open','closed')),
  created_at timestamptz not null default now()
);
create index on public.markets (org_id, date);

create table public.market_products (
  org_id      uuid not null default public.my_org() references public.orgs on delete cascade,
  market_id   uuid not null references public.markets on delete cascade,
  product_id  uuid not null references public.products on delete cascade,
  price       integer not null default 0 check (price >= 0),
  qty_brought integer not null default 0 check (qty_brought >= 0),
  sold_out    boolean not null default false,   -- manual "sold out" switch
  sort        integer not null default 0,
  primary key (market_id, product_id)
);

create table public.orders (
  id               uuid primary key,            -- created on the phone (works offline)
  org_id           uuid not null default public.my_org() references public.orgs on delete cascade,
  market_id        uuid references public.markets on delete set null,   -- where it was taken
  code             text not null,               -- short code shown to people, e.g. K7QM
  token            text not null unique check (length(token) >= 20),  -- secret for the customer link
  customer_name    text not null default '',
  phone            text not null default '',
  pickup_kind      text not null default 'market' check (pickup_kind in ('market','shop')),
  pickup_market_id uuid references public.markets on delete set null,
  pickup_date      date,
  pickup_time      text not null default '',
  note             text not null default '',
  paid             boolean not null default false,
  payment_type     text check (payment_type in ('cash','linepay','transfer')),
  paid_market_id   uuid references public.markets on delete set null,  -- where the money was taken
  status           text not null default 'waiting' check (status in ('waiting','ready','picked_up')),
  imported         boolean not null default false,
  created_by       text not null default public.my_email(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  picked_up_at     timestamptz
);
create unique index orders_open_code on public.orders (org_id, code) where status <> 'picked_up';
create index on public.orders (org_id, phone);
create index on public.orders (pickup_market_id);

create table public.order_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default public.my_org() references public.orgs on delete cascade,
  order_id   uuid not null references public.orders on delete cascade,
  product_id uuid references public.products on delete set null,
  name_en    text not null default '',
  name_zh    text not null default '',
  qty        integer not null check (qty > 0),
  unit_price integer not null default 0 check (unit_price >= 0)
);
create index on public.order_items (order_id);

create table public.sales (
  id           uuid primary key,                -- created on the phone (works offline)
  org_id       uuid not null default public.my_org() references public.orgs on delete cascade,
  market_id    uuid not null references public.markets on delete cascade,
  product_id   uuid not null references public.products on delete cascade,
  qty          integer not null default 1 check (qty > 0),
  unit_price   integer not null default 0 check (unit_price >= 0),
  payment_type text not null default 'cash' check (payment_type in ('cash','linepay','transfer')),
  created_by   text not null default public.my_email(),
  created_at   timestamptz not null default now()
);
create index on public.sales (market_id);

-- keep updated_at fresh
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch();

-- ---------- Row Level Security ----------------------------------------
alter table public.orgs            enable row level security;
alter table public.members         enable row level security;
alter table public.products        enable row level security;
alter table public.markets         enable row level security;
alter table public.market_products enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.sales           enable row level security;

-- customers (not logged in) get nothing from the tables at all
revoke all on all tables in schema public from anon;

-- orgs: team can read, owner can edit
create policy org_read  on public.orgs for select to authenticated using (id = my_org());
create policy org_edit  on public.orgs for update to authenticated using (id = my_org() and is_owner()) with check (id = my_org());

-- members: team can see the team, owner manages it
create policy mem_read  on public.members for select to authenticated using (org_id = my_org());
create policy mem_ins   on public.members for insert to authenticated with check (org_id = my_org() and is_owner());
create policy mem_upd   on public.members for update to authenticated using (org_id = my_org() and is_owner()) with check (org_id = my_org());
create policy mem_del   on public.members for delete to authenticated using (org_id = my_org() and is_owner() and email <> my_email());

-- catalogue + markets: team reads, owner edits
create policy prod_read on public.products for select to authenticated using (org_id = my_org());
create policy prod_all  on public.products for all    to authenticated using (org_id = my_org() and is_owner()) with check (org_id = my_org() and is_owner());
create policy mkt_read  on public.markets  for select to authenticated using (org_id = my_org());
create policy mkt_all   on public.markets  for all    to authenticated using (org_id = my_org() and is_owner()) with check (org_id = my_org() and is_owner());
create policy mp_read   on public.market_products for select to authenticated using (org_id = my_org());
create policy mp_all    on public.market_products for all to authenticated using (org_id = my_org() and is_owner()) with check (org_id = my_org() and is_owner());

-- orders: whole team can create, update and delete
create policy ord_all   on public.orders      for all to authenticated using (org_id = my_org()) with check (org_id = my_org());
create policy item_all  on public.order_items for all to authenticated using (org_id = my_org()) with check (org_id = my_org());

-- sales: team adds; staff see / undo only their own from the last 12 h / 10 min; owner sees all
create policy sale_ins  on public.sales for insert to authenticated with check (org_id = my_org());
create policy sale_read on public.sales for select to authenticated using (
  org_id = my_org() and (is_owner() or (created_by = my_email() and created_at > now() - interval '12 hours')));
create policy sale_del  on public.sales for delete to authenticated using (
  org_id = my_org() and (is_owner() or (created_by = my_email() and created_at > now() - interval '10 minutes')));
create policy sale_upd  on public.sales for update to authenticated using (org_id = my_org() and is_owner()) with check (org_id = my_org());

-- ---------- functions the app calls -----------------------------------

-- Customer page: look up ONE order by its secret token. Never returns phone or name.
create or replace function public.get_order_by_token(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', o.code, 'status', o.status, 'paid', o.paid,
    'pickup_kind', o.pickup_kind, 'pickup_date', o.pickup_date, 'pickup_time', o.pickup_time,
    'note', o.note, 'created_at', o.created_at, 'picked_up_at', o.picked_up_at,
    'items', coalesce((select json_agg(json_build_object('en', i.name_en, 'zh', i.name_zh, 'qty', i.qty))
                       from order_items i where i.order_id = o.id), '[]'::json),
    'market', (select json_build_object('name', m.name, 'date', m.date, 'location', m.location)
               from markets m where m.id = o.pickup_market_id),
    'shop', (select json_build_object('name', g.name, 'address', g.address, 'hours', g.hours, 'line', g.line_id)
             from orgs g where g.id = o.org_id))
  from orders o
  where o.token = p_token and length(p_token) >= 20
$$;

-- Save a whole order (order + items) in one go. Safe to repeat (offline sync).
create or replace function public.save_order(p_order jsonb, p_items jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare v_id uuid := (p_order ->> 'id')::uuid;
begin
  insert into orders (id, market_id, code, token, customer_name, phone, pickup_kind, pickup_market_id,
                      pickup_date, pickup_time, note, paid, payment_type, paid_market_id, status,
                      imported, created_at, picked_up_at)
  values (v_id, (p_order->>'market_id')::uuid, p_order->>'code', p_order->>'token',
          coalesce(p_order->>'customer_name',''), coalesce(p_order->>'phone',''),
          coalesce(p_order->>'pickup_kind','market'), (p_order->>'pickup_market_id')::uuid,
          (p_order->>'pickup_date')::date, coalesce(p_order->>'pickup_time',''), coalesce(p_order->>'note',''),
          coalesce((p_order->>'paid')::boolean, false), p_order->>'payment_type', (p_order->>'paid_market_id')::uuid,
          coalesce(p_order->>'status','waiting'), coalesce((p_order->>'imported')::boolean, false),
          coalesce((p_order->>'created_at')::timestamptz, now()), (p_order->>'picked_up_at')::timestamptz)
  on conflict (id) do update set
    customer_name = excluded.customer_name, phone = excluded.phone, pickup_kind = excluded.pickup_kind,
    pickup_market_id = excluded.pickup_market_id, pickup_date = excluded.pickup_date,
    pickup_time = excluded.pickup_time, note = excluded.note;
  delete from order_items where order_id = v_id;
  insert into order_items (order_id, product_id, name_en, name_zh, qty, unit_price)
  select v_id, (x->>'product_id')::uuid, coalesce(x->>'name_en',''), coalesce(x->>'name_zh',''),
         (x->>'qty')::int, coalesce((x->>'unit_price')::int, 0)
  from jsonb_array_elements(p_items) x
  where (x->>'qty')::int > 0;
end $$;

-- Stock for one market (counts only, no money): brought − pre-orders collected here − sold
create or replace function public.market_stock(p_market uuid)
returns table (product_id uuid, brought int, preordered int, sold int, remaining int, sold_out boolean)
language sql stable security definer set search_path = public as $$
  select mp.product_id, mp.qty_brought,
         coalesce(po.q, 0)::int, coalesce(s.q, 0)::int,
         (mp.qty_brought - coalesce(po.q, 0) - coalesce(s.q, 0))::int,
         mp.sold_out or (mp.qty_brought - coalesce(po.q, 0) - coalesce(s.q, 0)) <= 0
  from market_products mp
  join markets m on m.id = mp.market_id and m.org_id = my_org()
  left join (select i.product_id, sum(i.qty) q from order_items i join orders o on o.id = i.order_id
             where o.pickup_market_id = p_market group by i.product_id) po on po.product_id = mp.product_id
  left join (select sa.product_id, sum(sa.qty) q from sales sa where sa.market_id = p_market
             group by sa.product_id) s on s.product_id = mp.product_id
  where mp.market_id = p_market
$$;

-- Owner-only money summary for one or more markets (e.g. all markets of one day)
create or replace function public.market_summary(p_markets uuid[]) returns json
language plpgsql stable security definer set search_path = public as $$
declare r json;
begin
  if not is_owner() then raise exception 'owner only'; end if;
  with mk as (select id from markets where id = any(p_markets) and org_id = my_org()),
  walk as (select s.product_id, s.payment_type, s.qty, s.qty * s.unit_price amt
           from sales s where s.market_id in (select id from mk)),
  pre_money as (select coalesce(o.payment_type,'unknown') payment_type, i.qty * i.unit_price amt
                from orders o join order_items i on i.order_id = o.id
                where o.paid and o.paid_market_id in (select id from mk)),
  pre_units as (select i.product_id, i.name_en, i.name_zh, i.qty
                from orders o join order_items i on i.order_id = o.id
                where o.status = 'picked_up' and o.pickup_market_id in (select id from mk)),
  units as (select product_id, sum(qty) filter (where src = 'walk') walk, sum(qty) filter (where src = 'pre') pre
            from (select product_id, qty, 'walk' src from walk
                  union all select product_id, qty, 'pre' from pre_units) u group by product_id)
  select json_build_object(
    'walkup_total',   coalesce((select sum(amt) from walk), 0),
    'preorder_total', coalesce((select sum(amt) from pre_money), 0),
    'by_payment', coalesce((select json_object_agg(payment_type, t) from
                    (select payment_type, sum(amt) t from
                      (select payment_type, amt from walk union all select payment_type, amt from pre_money) x
                     group by payment_type) y), '{}'::json),
    'units', coalesce((select json_agg(json_build_object(
                'product_id', u.product_id, 'en', p.name_en, 'zh', p.name_zh,
                'walkup', coalesce(u.walk,0), 'preorder', coalesce(u.pre,0)) order by p.sort, p.name_en)
              from units u left join products p on p.id = u.product_id), '[]'::json)
  ) into r;
  return r;
end $$;

-- ---------- who may call which function -------------------------------
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function public.get_order_by_token(text) to anon, authenticated;

-- Live updates for staff phones (orders list refreshes by itself)
alter publication supabase_realtime add table public.orders;
