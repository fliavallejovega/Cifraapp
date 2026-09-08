-- What it costs to pay this late, and how late «late» is.
--
-- A household deciding which bill to let slip this month is making exactly one
-- comparison, and the product could not help with it: every obligation looked
-- equally expensive to miss. They are not. A utility that adds five dollars
-- after ten days and a loan that adds five percent the day after are different
-- decisions, and the plan cannot order them without knowing which is which.
--
-- Two shapes, because contracts come in two shapes: a fixed charge and a
-- percentage of what is owed. They are separate columns rather than one number
-- with a unit flag, so a rate can never be read as an amount — that mistake
-- turns «5%» into «$5» silently, and on a two-thousand-dollar rent it is off
-- by two orders of magnitude in the direction that matters.
--
-- The check enforces that at most one is set. Both would be a fee nobody can
-- compute; neither is the ordinary case and means «no late fee stated».
--
-- Nothing here is assumed. A blank stays blank: this product does not invent a
-- penalty any more than it invents an interest rate.

alter table app.obligations
  add column if not exists late_fee_amount numeric(19, 4)
    check (late_fee_amount is null or late_fee_amount >= 0),
  add column if not exists late_fee_rate numeric(6, 3)
    check (late_fee_rate is null or (late_fee_rate >= 0 and late_fee_rate <= 100)),
  -- Days of grace after the due date. Zero is a real answer and a common one:
  -- plenty of contracts charge from the first day late.
  add column if not exists late_fee_after_days smallint
    check (late_fee_after_days is null or (late_fee_after_days >= 0 and late_fee_after_days <= 365));

alter table app.obligations
  drop constraint if exists obligations_one_late_fee_shape;

alter table app.obligations
  add constraint obligations_one_late_fee_shape
  check (late_fee_amount is null or late_fee_rate is null);

comment on column app.obligations.late_fee_amount is
  'Fixed charge added when this is paid late. Null means none stated.';
comment on column app.obligations.late_fee_rate is
  'Late charge as a percentage of the expected amount. Null means none stated.';
comment on column app.obligations.late_fee_after_days is
  'Days after the due date before the charge applies. Zero means immediately.';
