-- Where on the page a line was read, as a fraction of the page height (0 top,
-- 1 bottom). Only images carry it: it lets a question about a line show the
-- capture cut around that line, so a person checks it where they are asked.
alter table app.import_rows
  add column if not exists source_top numeric(5, 4)
    check (source_top is null or (source_top >= 0 and source_top <= 1));

comment on column app.import_rows.source_top is
  'Vertical position of the line in its source image, 0 (top) to 1 (bottom). Null for text formats.';
