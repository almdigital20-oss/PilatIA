create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  evolution_instance text unique,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin','manager','agent')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table public.conversations add column if not exists company_id uuid references public.companies(id) on delete cascade;
create index if not exists conversations_company_phone_idx on public.conversations(company_id, phone);
create index if not exists company_members_user_idx on public.company_members(user_id);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.conversations enable row level security;

drop policy if exists companies_member_select on public.companies;
create policy companies_member_select on public.companies for select to authenticated
using (exists (select 1 from public.company_members m where m.company_id = companies.id and m.user_id = auth.uid()));

drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update on public.companies for update to authenticated
using (exists (select 1 from public.company_members m where m.company_id = companies.id and m.user_id = auth.uid() and m.role = 'admin'));

drop policy if exists members_same_company_select on public.company_members;
create policy members_same_company_select on public.company_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists conversations_company_access on public.conversations;
create policy conversations_company_access on public.conversations for all to authenticated
using (exists (select 1 from public.company_members m where m.company_id = conversations.company_id and m.user_id = auth.uid()))
with check (exists (select 1 from public.company_members m where m.company_id = conversations.company_id and m.user_id = auth.uid()));
