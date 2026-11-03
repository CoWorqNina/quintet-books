-- Combined payment (#44): one transfer paying several bills and loan installments at once.
-- Adds the 'loan_payments' register type (several installments paid by one entry).
-- Run after 0009_open_items.sql.

create or replace function insert_register(p_user uuid, p_register jsonb, p_entry_id bigint) returns bigint
language plpgsql as $$
declare
  d jsonb := p_register -> 'data';
  v_id bigint;
  v_inst jsonb;
  v_n int;
begin
  case p_register ->> 'type'
  when 'asset' then
    insert into fixed_assets (name, book, account_code, accum_account_code, profit_center, cost, acquired_date,
                              in_use_date, useful_life_months, depreciated_before_go_live, popup, notes, entry_id, created_by)
    values (d ->> 'name', (d ->> 'book')::book, d ->> 'account_code', d ->> 'accum_account_code',
            (d ->> 'profit_center')::profit_center, (d ->> 'cost')::numeric, (d ->> 'acquired_date')::date,
            (d ->> 'in_use_date')::date, (d ->> 'useful_life_months')::int,
            coalesce((d ->> 'depreciated_before_go_live')::numeric, 0), coalesce((d ->> 'popup')::boolean, false),
            d ->> 'notes', p_entry_id, p_user)
    returning id into v_id;
  when 'spread' then
    insert into spread_schedules (kind, name, book, asset_account, expense_account, profit_center, total, start_month,
                                  months, amortized_before_go_live, entry_id, created_by)
    values (d ->> 'kind', d ->> 'name', (d ->> 'book')::book, d ->> 'asset_account', d ->> 'expense_account',
            (d ->> 'profit_center')::profit_center, (d ->> 'total')::numeric, (d ->> 'start_month')::date,
            (d ->> 'months')::int, coalesce((d ->> 'amortized_before_go_live')::numeric, 0), p_entry_id, p_user)
    returning id into v_id;
  when 'loan' then
    if exists (select 1 from loans l where l.account_code = d ->> 'account_code' and entry_in_force(l.entry_id)) then
      raise exception 'Account % already has a loan; add a new Loans Payable account for this loan', d ->> 'account_code'
        using errcode = 'P0001';
    end if;
    insert into loans (name, lender_party_id, lender_name, account_code, interest_account, book, principal, annual_rate,
                       term_months, start_date, informal, notes, method, installment_amount, entry_id, created_by)
    values (d ->> 'name', d ->> 'lender_party_id', d ->> 'lender_name', d ->> 'account_code', d ->> 'interest_account',
            coalesce((d ->> 'book')::book, 'Store'), (d ->> 'principal')::numeric,
            coalesce((d ->> 'annual_rate')::numeric, 0), (d ->> 'term_months')::int, (d ->> 'start_date')::date,
            coalesce((d ->> 'informal')::boolean, false), d ->> 'notes', coalesce(d ->> 'method', 'straight-line'),
            (d ->> 'installment_amount')::numeric, p_entry_id, p_user)
    returning id into v_id;
    for v_inst in select * from jsonb_array_elements(d -> 'installments') loop
      insert into loan_installments (loan_id, seq, due_date, principal, interest, paid_before_go_live, interest_before_go_live)
      values (v_id, (v_inst ->> 'seq')::int, (v_inst ->> 'due_date')::date, (v_inst ->> 'principal')::numeric,
              (v_inst ->> 'interest')::numeric, coalesce((v_inst ->> 'paid_before_go_live')::boolean, false),
              coalesce((v_inst ->> 'interest_before_go_live')::boolean, false));
    end loop;
    -- The schedule must add up to the principal (straight-line rows are checked by the app too).
    if (select coalesce(sum(principal), 0) from loan_installments where loan_id = v_id) <> (d ->> 'principal')::numeric then
      raise exception 'The schedule''s principal doesn''t add up to the loan' using errcode = 'P0001';
    end if;
  when 'loan_payment' then
    update loan_installments i set paid_entry_id = p_entry_id
    where i.id = (d ->> 'installment_id')::bigint and not installment_paid(i)
    returning i.id into v_id;
    if v_id is null then
      raise exception 'That installment is already paid' using errcode = 'P0001';
    end if;
  when 'loan_payments' then
    -- One payment covering several installments (e.g. one transfer to an owner for card loans).
    update loan_installments i set paid_entry_id = p_entry_id
    where i.id in (select (x #>> '{}')::bigint from jsonb_array_elements(d -> 'installment_ids') x)
      and not installment_paid(i);
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(d -> 'installment_ids') then
      raise exception 'One of those installments is already paid' using errcode = 'P0001';
    end if;
    v_id := p_entry_id;
  when 'loan_interest' then
    -- Month-end accrual: links each row to the entry that booked its interest.
    update loan_installments i set interest_entry_id = p_entry_id
    where i.id in (select (x #>> '{}')::bigint from jsonb_array_elements(d -> 'installment_ids') x)
      and not installment_interest_recorded(i);
    get diagnostics v_n = row_count;
    if v_n <> jsonb_array_length(d -> 'installment_ids') then
      raise exception 'Some of that interest is already recorded' using errcode = 'P0001';
    end if;
    v_id := p_entry_id;
  else
    raise exception 'Unknown register type %', p_register ->> 'type' using errcode = 'P0001';
  end case;

  insert into audit_log (user_id, action, entity, entity_id, details)
  values (p_user, 'Create', p_register ->> 'type', v_id::text, jsonb_build_object('entry_id', p_entry_id));
  return v_id;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
