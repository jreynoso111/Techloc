alter table public.profiles
  add column if not exists map_category text not null default 'general';

alter table public.profiles
  drop constraint if exists profiles_map_category_check;

alter table public.profiles
  add constraint profiles_map_category_check
  check (map_category in ('general', 'technician', 'sales', 'repair', 'fleet', 'admin'));

grant update (map_category) on public.profiles to authenticated;
