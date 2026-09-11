-- Las plantillas de correo son de la consola, y de nadie más.
--
-- Como el resto de `platform`: seguridad de fila activada y forzada, sin
-- políticas, y sin permisos para `anon` ni `authenticated`. La consola entra
-- con el rol de servicio y decide ella quién edita; la app las lee desde el
-- despacho de avisos, que corre con el mismo rol. Un cliente con la clave
-- pública no tiene nada que leer aquí: un texto sin publicar es un borrador, y
-- un borrador de un correo de seguridad no es algo para dejar a la vista.

alter table platform.email_templates enable row level security;
alter table platform.email_templates force row level security;

alter table platform.email_template_versions enable row level security;
alter table platform.email_template_versions force row level security;

revoke all on platform.email_templates from anon, authenticated;
revoke all on platform.email_template_versions from anon, authenticated;
