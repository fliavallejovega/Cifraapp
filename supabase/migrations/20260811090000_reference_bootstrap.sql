-- Reference rows the later migrations depend on.
--
-- Currencies and jurisdictions were introduced as tables in Phase 0 and filled
-- by `pnpm db:seed`, which runs *after* migrations. That was fine while nothing
-- in a migration referenced them. It stopped being fine the moment a migration
-- wanted to ship its own catalogue — the AI model list, the plan catalogue, the
-- Panama tax rule set — because each of those carries a currency and a foreign
-- key, and on an empty database the key has nothing to point at.
--
-- Rather than have every later migration carry a copy of USD, the minimum set
-- lands here, once, before any of them. `do nothing` on conflict, so the seed
-- stays authoritative for names and translations and this file never fights it.
--
-- Found by rebuilding the database from empty, which is the only way this class
-- of ordering bug shows up: it is invisible on any database that has ever been
-- seeded.

insert into platform.currencies (code, name_en, name_es, symbol, minor_units)
values
  ('USD', 'US Dollar', 'Dólar estadounidense', '$', 2),
  -- Kept distinct from the dollar despite the 1:1 peg. A peg is a policy, not
  -- an identity, and the day it moves every historical figure must still mean
  -- what it meant.
  ('PAB', 'Panamanian Balboa', 'Balboa panameño', 'B/.', 2)
on conflict (code) do nothing;

insert into platform.tax_jurisdictions
  (code, name_en, name_es, authority_name, authority_url, default_currency, is_supported)
values
  ('PA', 'Panama', 'Panamá', 'Dirección General de Ingresos', 'https://dgi.mef.gob.pa/', 'PAB',
   -- False, and it stays false until reviewed rules exist. The Panama rule set
   -- two migrations later is an unreviewed draft.
   false)
on conflict (code) do nothing;
