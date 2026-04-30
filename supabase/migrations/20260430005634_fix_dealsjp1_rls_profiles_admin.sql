create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.status::text, 'active')) = 'active'
  );
$$;

create or replace function public.is_active_administrator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(coalesce(p.role::text, '')) = 'administrator'
      and lower(coalesce(p.status::text, 'active')) = 'active'
  );
$$;

create or replace function public.is_active_administrator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_active_administrator(auth.uid());
$$;

create or replace function public.require_active_administrator_for_client()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if not public.is_active_administrator(auth.uid()) then
    raise exception 'Active administrator role is required.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.is_active_user() from public;
revoke all on function public.is_active_administrator(uuid) from public;
revoke all on function public.is_active_administrator() from public;
revoke all on function public.require_active_administrator_for_client() from public;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_active_administrator(uuid) to authenticated;
grant execute on function public.is_active_administrator() to authenticated;
grant execute on function public.require_active_administrator_for_client() to authenticated;

grant select, insert, update, delete on public.profiles to service_role;
grant select on public.profiles to authenticated;
grant update (email, name, role, status, background_mode, last_connection) on public.profiles to authenticated;
grant select, insert, update, delete on public."DealsJP1" to authenticated;
grant select, insert, update, delete on public."DealsJP1" to service_role;

alter table public."DealsJP1" enable row level security;

drop policy if exists "Enable insert access for authenticated users" on public."DealsJP1";
drop policy if exists "Enable read access for authenticated users" on public."DealsJP1";
drop policy if exists "Enable update access for authenticated users" on public."DealsJP1";
drop policy if exists "Strict Admin Access" on public."DealsJP1";
drop policy if exists "public read dealsjp1" on public."DealsJP1";
drop policy if exists "dealsjp1_select_active" on public."DealsJP1";
drop policy if exists "dealsjp1_write_admin" on public."DealsJP1";

create policy "dealsjp1_select_active" on public."DealsJP1"
  for select to authenticated using (public.is_active_user());

create policy "dealsjp1_write_admin" on public."DealsJP1"
  for all to authenticated
  using (public.is_active_administrator())
  with check (public.is_active_administrator());
