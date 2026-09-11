#!/usr/bin/env node
/**
 * E10 — Lo que Supabase manda es exactamente lo que el catálogo renderiza,
 * con lo editado en la consola encima.
 *
 * Se lee la configuración viva de Supabase y se compara campo por campo. Un
 * «publicado» guardado en nuestra base no sirve de prueba: alguien puede tocar
 * el panel de Supabase a mano y la base seguiría diciendo que todo está bien.
 */
import { connect } from './_db.mjs';
import { effectiveCopiesFromDb, loadEmail, loadSecrets, supabaseConfig } from './_email.mjs';

const { CATALOGUE, supabaseFieldsFor } = await loadEmail();
const secrets = loadSecrets();
const live = await supabaseConfig(secrets);
const sql = connect();

const problems = [];
let checked = 0;
try {
  for (const definition of CATALOGUE.filter((one) => one.channel === 'supabase')) {
    const expected = supabaseFieldsFor(definition, await effectiveCopiesFromDb(sql, definition));
    for (const [field, value] of Object.entries(expected)) {
      checked += 1;
      if (live[field] !== value) problems.push(`${definition.key}: ${field} no coincide con el catálogo`);
    }
  }
} finally {
  await sql.end();
}

if (checked < 26) problems.push(`sólo se compararon ${checked} campos; se esperaban 26 (13 correos × asunto y cuerpo)`);

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log(`SUPABASE TEMPLATES PUBLISHED OK (${checked} campos)`);
