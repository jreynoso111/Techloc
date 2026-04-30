grant usage on schema public to service_role;

grant select, insert, update, delete on public."DealsJP1" to service_role;
grant select, insert, update, delete on public."PT-LastPing" to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.vehicles to service_role;
grant select, insert, update, delete on public.gps_blacklist to service_role;

grant usage, select on all sequences in schema public to service_role;
