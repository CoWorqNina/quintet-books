-- Loans: straight-line schedules with per-row interest tracking.
--   * each installment row records whether its interest is booked (interest_recorded): by the
--     month-end accrual (interest_entry_id), by the payment itself, or because it was paid
--     before go-live (paid_before_go_live, no journal entry: it's in the opening balances)
--   * loans keep their installment amount and method
-- Run after 0006_statements.sql.

alter table loans add column method text not null default 'straight-line';
alter table loans add column installment_amount numeric(14, 2);
alter table loan_installments add column interest_entry_id bigint references entries (id);
alter table loan_installments add column paid_before_go_live boolean not null default false;

-- Paid: before go-live, or by a payment entry still in force.
create function installment_paid(i loan_installments) returns boolean
language sql stable as $$
  select i.paid_before_go_live or (i.paid_entry_id is not null and entry_in_force(i.paid_entry_id))
$$;

-- Interest booked exactly once: by the accrual, by the payment, or before go-live.
create function installment_interest_recorded(i loan_installments) returns boolean
language sql stable as $$
  select installment_paid(i) or (i.interest_entry_id is not null and entry_in_force(i.interest_entry_id))
$$;

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
      insert into loan_installments (loan_id, seq, due_date, principal, interest, paid_before_go_live)
      values (v_id, (v_inst ->> 'seq')::int, (v_inst ->> 'due_date')::date, (v_inst ->> 'principal')::numeric,
              (v_inst ->> 'interest')::numeric, coalesce((v_inst ->> 'paid_before_go_live')::boolean, false));
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

-- Loans in force with their next unpaid installment and whether its interest is recorded.
drop function open_loans();
create function open_loans()
returns table (id bigint, name text, account_code text, interest_account text, book book,
               next_id bigint, next_seq int, next_due date, next_principal numeric, next_interest numeric,
               next_interest_recorded boolean)
language sql stable as $$
  select l.id, l.name, l.account_code, l.interest_account, l.book,
         n.id, n.seq, n.due_date, n.principal, n.interest, n.recorded
  from loans l
  left join lateral (
    select i.id, i.seq, i.due_date, i.principal, i.interest, installment_interest_recorded(i) as recorded
    from loan_installments i
    where i.loan_id = l.id and not installment_paid(i)
    order by i.seq limit 1
  ) n on true
  where entry_in_force(l.entry_id)
  order by l.name
$$;

create or replace function registers_overview() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'assets', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'in_force', entry_in_force(a.entry_id),
        'entry_status', (select e.status from entries e where e.id = a.entry_id)) order by a.in_use_date, a.id)
      from fixed_assets a), '[]'),
    'spreads', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
        'in_force', entry_in_force(s.entry_id),
        'entry_status', (select e.status from entries e where e.id = s.entry_id)) order by s.start_month, s.id)
      from spread_schedules s), '[]'),
    'loans', coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
        'in_force', entry_in_force(l.entry_id),
        'entry_status', (select e.status from entries e where e.id = l.entry_id),
        'installments', (select jsonb_agg(jsonb_build_object(
            'id', i.id, 'seq', i.seq, 'due_date', i.due_date, 'principal', i.principal, 'interest', i.interest,
            'paid', installment_paid(i),
            'paid_before_go_live', i.paid_before_go_live,
            'paid_entry_id', case when i.paid_entry_id is not null and entry_in_force(i.paid_entry_id) then i.paid_entry_id end,
            'date_paid', (select e.entry_date from entries e where e.id = i.paid_entry_id and entry_in_force(i.paid_entry_id)),
            'payment_status', (select e.status from entries e where e.id = i.paid_entry_id and entry_in_force(i.paid_entry_id)),
            'interest_recorded', installment_interest_recorded(i),
            'interest_entry_id', case when i.interest_entry_id is not null and entry_in_force(i.interest_entry_id) then i.interest_entry_id end,
            'interest_status', (select e.status from entries e where e.id = i.interest_entry_id and entry_in_force(i.interest_entry_id)))
          order by i.seq) from loan_installments i where i.loan_id = l.id)) order by l.start_date, l.id)
      from loans l), '[]'))
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
