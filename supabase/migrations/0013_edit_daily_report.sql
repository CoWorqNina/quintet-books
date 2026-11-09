-- Edit a daily report that's still waiting for approval: the old report and its entries are
-- cancelled and the corrected report is created in their place, in one step (so the day is
-- never left without a report). Not possible once any of its entries is approved.
-- Run after 0012_line_suppliers.sql.

create or replace function replace_daily_report(p_user uuid, p_id bigint, p_report jsonb, p_entries jsonb)
returns jsonb
language plpgsql as $$
begin
  perform cancel_daily_report(p_user, p_id, 'Edited and resubmitted');
  return create_daily_report(p_user, p_report, p_entries);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
