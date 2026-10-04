-- The lines cut at the top and bottom edge of a capture, as far as they could
-- be read. Never filed; they are the evidence of whether two neighbouring
-- captures meet or leave something out between them.
alter table app.imports
  add column if not exists edge_lines jsonb,
  -- The household said nothing is missing between this capture and the newer
  -- one before it.
  add column if not exists continuity_confirmed boolean not null default false;

comment on column app.imports.edge_lines is
  'Partially visible lines at the edges of a capture: {top, bottom}, each {date, amount, description} or null.';
comment on column app.imports.continuity_confirmed is
  'The household confirmed nothing is missing between this capture and the newer one before it.';
