#!/usr/bin/env node
/**
 * G13 — Una tarjeta o una cuenta se opera desde donde está, no en otra pantalla.
 *
 * Es la misma regla por la que el panel de gestión vive dentro de su tarjeta: un
 * control que no toca lo que modifica obliga a contar posiciones, y un enlace
 * que saca a alguien de donde estaba le cobra el viaje de vuelta.
 *
 * La regla se rompió una vez —se pusieron enlaces a `/movements/new` en la
 * tarjeta y en la cuenta— y por eso existe este gate: la intención no se
 * sostiene sola.
 */
import { readFileSync } from 'node:fs';

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const problems = [];

const WATCHED = [
  ['apps/web/src/app/[locale]/(product)/cards/page.tsx', 'la pantalla de tarjetas'],
  ['apps/web/src/components/cards-manager.tsx', 'el panel de una tarjeta'],
  ['apps/web/src/components/accounts-manager.tsx', 'la lista de cuentas'],
];

for (const [file, what] of WATCHED) {
  const source = strip(readFileSync(file, 'utf8'));
  if (/movements\/new/.test(source)) {
    problems.push(`${what} manda a otra pantalla a registrar un movimiento`);
  }
}

// Y que el formulario esté de verdad ahí: prohibir el enlace sin exigir el
// reemplazo dejaría pasar quitar la función entera.
const panel = strip(readFileSync('apps/web/src/components/cards-manager.tsx', 'utf8'));
// La definición y el uso, no la cadena: buscar «CardMovements» a secas pasaba
// igual con la función renombrada, porque el sitio de llamada la seguía
// mencionando. Un gate que sobrevive a que le quiten lo que mide no mide nada.
if (
  !/function CardMovements\(/.test(panel) ||
  !panel.includes('<CardMovements') ||
  !panel.includes('createManualMovement')
) {
  problems.push('el panel de una tarjeta no tiene formulario para registrar');
}

const list = strip(readFileSync('apps/web/src/components/accounts-manager.tsx', 'utf8'));
if (
  !/function QuickMovement\(/.test(list) ||
  !list.includes('<QuickMovement') ||
  !list.includes('createManualMovement')
) {
  problems.push('la lista de cuentas no tiene formulario para registrar');
}

/*
  Y un pago se reconoce por hacia dónde va el dinero, no por su signo.

  Pagar una tarjeta es dinero entrando a la cuenta de esa tarjeta; pagarle a
  Giovanni es dinero saliendo de otra. Exigir «salida» a secas dejaba sin efecto
  el caso más común, que es el pago a la tarjeta.
*/
/*
  La regla vive en un solo sitio, y las dos rutas la usan.

  Estuvo escrita dos veces —al anotar a mano y al confirmar una importación— y
  la segunda copia se quedó sin la corrección: el pago a una tarjeta importado
  entraba como gasto y no bajaba nada. Un pago se registra por dos caminos y
  tiene que significar lo mismo por los dos.
*/
const home = strip(readFileSync('apps/web/src/server/debt-payments.ts', 'utf8'));
if (!/export function paysTheDebt\(/.test(home)) {
  problems.push('la regla de qué cuenta como pago no vive en un solo sitio');
}
if (!home.includes("direction === 'inflow'")) {
  problems.push('la regla no reconoce que pagar una tarjeta es dinero entrando a su cuenta');
}

for (const route of [
  ['apps/web/src/server/movement-actions.ts', 'anotar un movimiento a mano'],
  ['apps/web/src/server/import-actions.ts', 'confirmar una importación'],
]) {
  const [file, what] = route;
  const source = strip(readFileSync(file, 'utf8'));

  if (source.includes('applyPaymentToDebt(') && !source.includes('paysTheDebt(')) {
    problems.push(`${what} aplica un pago sin usar la regla compartida`);
  }

  /*
    Y un pago nace como transferencia.

    No es gasto ni ingreso: es plata moviéndose de un bolsillo a otro de la
    misma casa. Contarlo como gasto lo cuenta dos veces, y ponerlo en la cola de
    «sin rubro» crea un pendiente que nunca se puede resolver.
  */
  if (source.includes('applyPaymentToDebt(') && !source.includes("'transfer'")) {
    problems.push(`${what} deja el pago como gasto en vez de transferencia`);
  }
}

if (problems.length > 0) {
  console.error(problems.map((one) => `- ${one}`).join('\n'));
  process.exit(1);
}
console.log('INLINE INTERACTIONS OK');
