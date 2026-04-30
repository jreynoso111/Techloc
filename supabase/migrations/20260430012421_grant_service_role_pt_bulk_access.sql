grant usage on schema public to service_role;

grant select, insert, update, delete on public."PT-LastPing" to service_role;
grant select on public."DealsJP1" to service_role;
grant select on public.gps_blacklist to service_role;
grant select, update on public.vehicles to service_role;

grant execute on function public.finalize_pt_lastping_upload(text[], bigint) to service_role;
