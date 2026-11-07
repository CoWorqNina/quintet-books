-- Partner: an owner who submits expenses and views the books and reports, but can't approve,
-- post adjustments, close months or manage users (those stay with role 'Owner').
-- Run after 0010_combined_payment.sql.

alter type app_role add value if not exists 'Partner';
