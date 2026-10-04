-- Other digit groups a bank prints for this card. The household stores the last
-- four; a bank's payment line often shows the first four («PAGO VISA 4468-...»).
-- Linking those digits to the card is what lets a payment be read as a payment
-- to this card instead of an expense.
alter table app.accounts
  add column if not exists card_alias_digits text[] not null default '{}';

comment on column app.accounts.card_alias_digits is
  'Four-digit groups a bank prints for this card besides masked_number, linked by the household.';
