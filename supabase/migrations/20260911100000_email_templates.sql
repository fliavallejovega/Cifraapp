-- Las plantillas de correo, editables desde la consola.
--
-- ## Por qué la tabla guarda sólo lo editado
--
-- El texto de fábrica de cada correo vive en el código, en `@app/email`, junto
-- al diseño que lo presenta. Esta tabla guarda únicamente lo que alguien cambió
-- desde la consola. Sin una fila, el correo sale con su texto de fábrica.
--
-- Sembrar aquí una copia del texto de fábrica crearía dos fuentes de verdad, y
-- la primera vez que alguien corrigiera una coma en el código el correo seguiría
-- saliendo con la vieja. Con la tabla vacía por defecto, el código manda hasta
-- que una persona decide lo contrario.
--
-- ## Por qué campos y no HTML
--
-- Se edita el asunto, el texto de vista previa, el título, el cuerpo, el botón y
-- la nota al pie. El diseño queda fijo. El HTML de correo no es el de la web —
-- tablas, estilos en línea, clientes que ignoran la mitad del CSS— y un error en
-- el correo de inicio de sesión deja a todos afuera del producto.
--
-- ## Por qué cada guardado deja una versión
--
-- Para poder volver. Un correo que salió mal a un hogar no se puede
-- desenviar; lo único que queda es saber qué decía y restaurar lo anterior.

create table if not exists platform.email_templates (
  template_key text not null,
  locale text not null,
  subject text not null,
  preheader text not null default '',
  heading text not null,
  body text not null,
  cta_label text not null default '',
  footnote text not null default '',
  version integer not null default 1,
  updated_by uuid references app.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  -- Sólo para las plantillas de cuenta: cuándo se publicó en Supabase la
  -- versión vigente. Nulo es «hay cambios que Supabase todavía no tiene».
  published_at timestamptz,
  published_version integer,
  primary key (template_key, locale),
  constraint email_templates_locale_check check (locale in ('es', 'en')),
  constraint email_templates_subject_length check (char_length(subject) between 1 and 160),
  constraint email_templates_heading_length check (char_length(heading) between 1 and 160),
  constraint email_templates_body_length check (char_length(body) between 1 and 4000)
);

create table if not exists platform.email_template_versions (
  id uuid primary key default public.uuid_generate_v7(),
  template_key text not null,
  locale text not null,
  version integer not null,
  subject text not null,
  preheader text not null,
  heading text not null,
  body text not null,
  cta_label text not null,
  footnote text not null,
  created_by uuid references app.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Qué pasó: una edición, o volver a una versión anterior.
  reason text not null default 'edit',
  constraint email_template_versions_reason_check check (reason in ('edit', 'restore', 'reset')),
  constraint email_template_versions_unique unique (template_key, locale, version)
);

create index if not exists email_template_versions_lookup_idx
  on platform.email_template_versions (template_key, locale, version desc);

comment on table platform.email_templates is
  'Sólo lo editado en la consola. Sin fila, el correo sale con el texto de fábrica de @app/email.';
