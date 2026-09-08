-- Two more names for what a holding can be, and one that stays absent.
--
-- The first version of this table knew four kinds — equity, crypto, etf, other
-- — because four were all the quote endpoint could distinguish from a symbol
-- somebody had already typed correctly. Searching by name reaches a wider
-- index: a mutual fund and an index are ordinary things for a household to
-- hold, and calling either «other» throws away a fact the provider stated.
--
-- `bond` is deliberately **not** added. No market data provider classifies a
-- bond fund as a bond; it classifies it as a fund that holds debt, and a
-- household that owns `BND` owns an ETF. Storing `bond` would record a
-- classification nobody made — the exact thing this schema keeps out by
-- refusing a price without a source. Debt is something the search narrows by,
-- reading the fund's own name, and the kind that gets written is still the
-- one the provider gave.
--
-- Widening a check constraint accepts every row already stored, so this
-- rewrites nothing and can run against a live table.

alter table app.market_prices
  drop constraint if exists market_prices_kind_check;

alter table app.market_prices
  add constraint market_prices_kind_check
  check (kind in ('equity', 'crypto', 'etf', 'fund', 'index', 'other'));

alter table app.holdings
  drop constraint if exists holdings_kind_check;

alter table app.holdings
  add constraint holdings_kind_check
  check (kind in ('equity', 'crypto', 'etf', 'fund', 'index', 'other'));
