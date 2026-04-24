create or replace function public.prune_pt_lastping_older_than_3_months()
returns bigint
language plpgsql
set search_path to 'public'
as $function$
declare
  v_deleted bigint := 0;
begin
  delete from public."PT-LastPing"
  where "Date" < (now() - interval '3 months');

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid
    from cron.job
    where jobname = 'pt_lastping_retention_3_months'
  loop
    perform cron.unschedule(v_jobid);
  end loop;
exception
  when undefined_table then
    null;
end;
$$;

select cron.schedule(
  'pt_lastping_retention_3_months',
  '15 3 * * *',
  $$select public.prune_pt_lastping_older_than_3_months();$$
);
