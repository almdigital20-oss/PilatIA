-- PilatIA: ativacao segura do modo multiempresa e do usuario adicional.
-- Pode ser executado mais de uma vez. Nao remove usuarios, conversas ou configuracoes.

begin;

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
  role text not null default 'admin' check (role in ('admin', 'manager', 'agent')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

-- Copia cada empresa existente dos metadados do login para a tabela multiempresa.
-- DISTINCT ON impede duplicacao quando mais de um usuario ja pertence a mesma empresa.
insert into public.companies (id, name, evolution_instance, settings, active, created_at)
select distinct on (company_id)
  company_id,
  left(coalesce(nullif(metadata->>'pilatia_company_name', ''), nullif(metadata->>'company_name', ''), 'Empresa'), 120),
  nullif(metadata->>'pilatia_evolution_instance', ''),
  case when jsonb_typeof(metadata->'pilatia_settings') = 'object' then metadata->'pilatia_settings' else '{}'::jsonb end,
  coalesce((metadata->>'pilatia_active')::boolean, true),
  created_at
from (
  select
    id,
    created_at,
    coalesce(raw_user_meta_data, '{}'::jsonb) as metadata,
    (raw_user_meta_data->>'pilatia_company_id')::uuid as company_id
  from auth.users
  where coalesce(raw_user_meta_data->>'pilatia_company_id', '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
) existing_companies
order by company_id, created_at asc
on conflict (id) do update set
  name = excluded.name,
  evolution_instance = coalesce(excluded.evolution_instance, public.companies.evolution_instance),
  settings = case when excluded.settings = '{}'::jsonb then public.companies.settings else excluded.settings end,
  active = excluded.active;

-- Vincula os logins atuais as empresas corretas. O cadastro principal permanece admin.
insert into public.company_members (company_id, user_id, role, created_at)
select
  (raw_user_meta_data->>'pilatia_company_id')::uuid,
  id,
  case
    when raw_user_meta_data->>'pilatia_role' = 'agent' then 'agent'
    when raw_user_meta_data->>'pilatia_role' = 'manager' then 'manager'
    else 'admin'
  end,
  created_at
from auth.users
where coalesce(raw_user_meta_data->>'pilatia_company_id', '')
  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict (company_id, user_id) do update set role = excluded.role;

-- Mantem o historico antigo ligado a empresa correta.
alter table public.conversations
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.conversations conversation
set company_id = (conversation.summary->>'company_id')::uuid
where conversation.company_id is null
  and coalesce(conversation.summary->>'company_id', '')
    ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.companies company
    where company.id = (conversation.summary->>'company_id')::uuid
  );

create index if not exists conversations_company_phone_idx
  on public.conversations(company_id, phone);
create index if not exists company_members_user_idx
  on public.company_members(user_id);

alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.conversations enable row level security;

drop policy if exists companies_member_select on public.companies;
create policy companies_member_select on public.companies for select to authenticated
using (
  exists (
    select 1 from public.company_members member
    where member.company_id = companies.id and member.user_id = auth.uid()
  )
);

drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update on public.companies for update to authenticated
using (
  exists (
    select 1 from public.company_members member
    where member.company_id = companies.id
      and member.user_id = auth.uid()
      and member.role = 'admin'
  )
);

drop policy if exists members_same_company_select on public.company_members;
create policy members_same_company_select on public.company_members for select to authenticated
using (user_id = auth.uid());

drop policy if exists conversations_company_access on public.conversations;
create policy conversations_company_access on public.conversations for all to authenticated
using (
  exists (
    select 1 from public.company_members member
    where member.company_id = conversations.company_id and member.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.company_members member
    where member.company_id = conversations.company_id and member.user_id = auth.uid()
  )
);

-- Faz a API do Supabase reconhecer as novas tabelas imediatamente.
notify pgrst, 'reload schema';

commit;

-- Resultado esperado: uma empresa e um administrador principal por cadastro atual.
select
  (select count(*) from public.companies) as empresas,
  (select count(*) from public.company_members) as usuarios_vinculados,
  (select count(*) from public.conversations where company_id is not null) as conversas_migradas;
