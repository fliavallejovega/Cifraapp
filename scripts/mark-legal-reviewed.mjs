#!/usr/bin/env node
/**
 * Estampa la revisión de un documento legal, con el nombre de quien la hizo.
 *
 * `legal_documents.reviewed_at` es lo que apaga el aviso de «sin revisar» que la
 * pantalla legal enseña sola. El aviso no se quita editando código: se quita
 * cuando alguien con licencia lee el texto y su nombre queda en la fila.
 *
 * Por eso esto es un script y no una migración. Una migración que estampara la
 * revisión escribiría en la base que un abogado revisó un texto que ningún
 * abogado revisó — un registro falso sobre un documento legal, que es de las
 * pocas cosas que este repositorio no debe poder hacer por descuido. El nombre
 * es obligatorio y no tiene valor por defecto: sin él, el script se niega.
 *
 *   node scripts/mark-legal-reviewed.mjs --kind terms --version 1.0 \
 *     --by "Lic. Nombre Apellido, idoneidad 1-234-5678"
 *
 * Añade `--dry-run` para ver la fila que se tocaría sin tocarla.
 */

import postgres from 'postgres';

const args = process.argv.slice(2);

function flag(name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

const kind = flag('kind') ?? 'terms';
const version = flag('version');
const by = flag('by');
const locale = flag('locale');
const dryRun = args.includes('--dry-run');

if (!version || !by || by.trim().length < 3) {
  console.error(
    'Falta el nombre de quien revisó, o la versión.\n' +
      '\n' +
      '  node scripts/mark-legal-reviewed.mjs --kind terms --version 1.0 \\\n' +
      '    --by "Lic. Nombre Apellido, idoneidad 1-234-5678"\n' +
      '\n' +
      'El nombre es obligatorio a propósito: sin él, esto escribiría en la base\n' +
      'que alguien revisó un texto que nadie revisó.',
  );
  process.exit(2);
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DIRECT_URL (o DATABASE_URL) en el entorno.');
  process.exit(2);
}

const sql = postgres(url, { max: 1 });

try {
  const rows = await sql`
    select kind, locale, version, title, reviewed_by, reviewed_at
      from platform.legal_documents
     where kind = ${kind}
       and version = ${version}
       ${locale ? sql`and locale = ${locale}` : sql``}
  `;

  if (rows.length === 0) {
    console.error(`No hay ningún documento ${kind} versión ${version}.`);
    process.exit(1);
  }

  for (const row of rows) {
    console.log(
      `${row.kind} · ${row.locale} · v${row.version} · ${row.title} · ` +
        (row.reviewed_at ? `revisado por ${row.reviewed_by}` : 'sin revisar'),
    );
  }

  if (dryRun) {
    console.log(`\n(dry run) Se estamparía: ${by}`);
    process.exit(0);
  }

  const updated = await sql`
    update platform.legal_documents
       set reviewed_by = ${by},
           reviewed_at = now()
     where kind = ${kind}
       and version = ${version}
       ${locale ? sql`and locale = ${locale}` : sql``}
     returning kind, locale, version
  `;

  console.log(`\nRevisión estampada en ${updated.length} fila(s) por: ${by}`);
} finally {
  await sql.end();
}
