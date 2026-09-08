-- Which salary a commitment is taken out of, when it never reaches the bank.
--
-- A household that pays rent from its account and one whose loan is deducted
-- from a payslip owe the same money and hold very different amounts of it. The
-- product could not tell the two apart: every obligation was a claim on a
-- balance, so a deduction at source was counted twice — once because the
-- salary was stated before it, and again because the obligation was subtracted
-- after it. The figure that came out was «lo que de verdad te queda», and it
-- was too low by exactly the deductions.
--
-- The column points at the income rather than being a boolean, because
-- «se descuenta» is not the useful fact — «se descuenta de cuál» is. A
-- household with two salaries needs to know which payslip shrinks, and a
-- person looking at a net figure needs to be able to see what was taken out of
-- it and by whom.
--
-- Null means the ordinary case: the household pays it, from money it holds.
-- `on delete set null`, because deleting the income must not delete the
-- obligation — the debt survives the job, and silently dropping a financial
-- claim is exactly the kind of destruction this schema refuses to do.

alter table app.obligations
  add column if not exists deducted_from_series_id uuid
    references app.recurring_series (id) on delete set null;

comment on column app.obligations.deducted_from_series_id is
  'The income this obligation is deducted from at source. Null means the household pays it from an account it holds.';

-- Read on every plan that has to separate what is claimed from what is held.
create index if not exists obligations_deducted_from_idx
  on app.obligations (deducted_from_series_id)
  where deducted_from_series_id is not null;
