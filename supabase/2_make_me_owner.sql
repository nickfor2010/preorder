-- Run this ONCE, after schema.sql, to create your shop and make you the owner.
-- Change the email below if you will log in with a different one.
with new_org as (
  insert into public.orgs (name) values ('My Shop 我的店') returning id
)
insert into public.members (org_id, email, role, name)
select id, 'nickfor2010@gmail.com', 'owner', 'Nicola' from new_org;
