-- Supabase Auth user_metadata is user-editable and must not be used in RLS.
-- Replace the legacy policy flagged by the security advisor with policies
-- backed by public.profiles via public.is_active_user/is_active_administrator.

alter table public."DealsJP1" enable row level security;

drop policy if exists "Strict Admin Access" on public."DealsJP1";
drop policy if exists "Enable insert access for authenticated users" on public."DealsJP1";
drop policy if exists "Enable read access for authenticated users" on public."DealsJP1";
drop policy if exists "Enable update access for authenticated users" on public."DealsJP1";
drop policy if exists "public read dealsjp1" on public."DealsJP1";
drop policy if exists "dealsjp1_select_active" on public."DealsJP1";
drop policy if exists "dealsjp1_write_admin" on public."DealsJP1";

create policy "dealsjp1_select_active" on public."DealsJP1"
  for select
  to authenticated
  using (public.is_active_user());

create policy "dealsjp1_write_admin" on public."DealsJP1"
  for all
  to authenticated
  using (public.is_active_administrator())
  with check (public.is_active_administrator());
