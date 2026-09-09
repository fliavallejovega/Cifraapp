# Gates: cerrar el 100% del plan de ingreso variable de Cifraapp

OWNS: packages/**, apps/web/**, supabase/migrations/**, docs/**

Scope: llevar a producción todo lo que el artifact deja pendiente — Fases B, C y D,
totales por persona, chat que propone cambios al plan, lectura de correo desde Google,
y compromisos publicados a Google Calendar y a Apple Calendar — más las tres decisiones
que el usuario ya aprobó.

- [x] G1: El motor del piso calcula un percentil bajo sobre historia real y distingue
      un piso medido de uno declarado.
  CHECK: pnpm exec vitest run income-floor
  EXPECT: 1 passed (1)
  CWD: packages/budget-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=ca0e0475568afdca47b294fbe3f10fa06829269199fc357d95cebbf09c262dfe; exit=0; EXPECT=matched; output-sha256=757facede526eb6d328f8be9507ec05beb7996f267e0b4234828cac6e73f3abf; output-bytes=265; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/budget-engine; path=6dc919bb4189/22 entries

- [x] G2: El objetivo del colchón sale de la volatilidad propia del hogar, no de una
      constante, y el excedente se retiene hasta alcanzarlo.
  CHECK: pnpm exec vitest run cushion
  EXPECT: 1 passed (1)
  CWD: packages/budget-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=a410c64075cf11cdf69e91762f9fc5a7675dea6e7f65861bc4448c5d5690006b; exit=0; EXPECT=matched; output-sha256=514cce19137cf14984b1408b9e89994bba97b0889e282571493706dbb960cbfc; output-bytes=264; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/budget-engine; path=6dc919bb4189/22 entries

- [x] G3: El motor de cobertura marca cada compromiso como cubierto, condicional o
      descubierto, y dice cuánto tiene que entrar y para cuándo.
  CHECK: pnpm exec vitest run coverage
  EXPECT: 1 passed (1)
  CWD: packages/budget-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=c484de29a61df5e5f692c424913594fb33f085b9ac14542cf6c95da5fa5fb126; exit=0; EXPECT=matched; output-sha256=497c65e61bd03d30a482518604dd138b841dd5f8d75a0f9b95d2bcdb4c1bddc6; output-bytes=264; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/budget-engine; path=6dc919bb4189/22 entries

- [x] G4: La reserva fiscal se aparta en el momento del cobro, con su porcentaje y su
      cuenta de reserva, y queda registrada con procedencia.
  CHECK: node scripts/gates/assert-contains.mjs apps/web/src/server/receivable-actions.ts reserveOnReceipt
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=aeb5254166d9b1ef42f21e13aaea7c7a4f98bcc5948903a46103259920b5f32b; exit=0; EXPECT=matched; output-sha256=e59075abb5708f36df193fff7155bd1674313fa04a30cd44e860e0166c4aa48e; output-bytes=79; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G5: Cuentas y deudas se totalizan por persona en la pantalla de Cuentas.
  CHECK: node scripts/gates/assert-contains.mjs apps/web/src/server/repositories/accounts.ts totalsByPerson
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=90aea9d372d465135b795eb6a9002726a6a1bae6103059c125757fb291c46bab; exit=0; EXPECT=matched; output-sha256=3ee4335abc220425f64f92d7a76c0d291fbfd410b153325f83f364b982e94bbb; output-bytes=80; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G6: El chat puede proponer cambios al plan como propuestas tipadas que sólo se
      aplican tras confirmación explícita, y nunca por el modelo.
  CHECK: pnpm exec vitest run proposal
  EXPECT: 1 passed (1)
  CWD: packages/ai
  EVIDENCE: automatic-evidence=v1; definition-sha256=f07f43e6c48b21875e7e4618bddc23c5ababc93172e8495b20814618a41b7fdb; exit=0; EXPECT=matched; output-sha256=470c34746060ca981bd4f4e0afa9b6ca543cda13fea6be6ab030a47ce4b7f930; output-bytes=254; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/ai; path=6dc919bb4189/22 entries

- [x] G7: El correo del hogar se lee desde Google con OAuth, y los avisos de
      transacción de bancos panameños se parsean a movimientos propuestos.
  CHECK: pnpm exec vitest run bank-alert
  EXPECT: 1 passed (1)
  CWD: packages/transaction-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=c85fedd200781098d7845eefef0c3edd83dc390e311a8b8aa4f70864ae35b371; exit=0; EXPECT=matched; output-sha256=8895ef8a63f54895f07f6626cb56d5418147026bf8465ef6505f557a08a6354e; output-bytes=270; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/transaction-engine; path=6dc919bb4189/22 entries

- [x] G8: Los compromisos se publican como calendario suscribible (ICS) válido, que
      es lo que Apple Calendar y Google Calendar consumen por URL.
  CHECK: pnpm exec vitest run calendar
  EXPECT: 1 passed (1)
  CWD: packages/budget-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=cea7c9963fa0f67067551695124aeffcc9b0ca522037854e9f9f1dfb60b940c2; exit=0; EXPECT=matched; output-sha256=e491f69f0efb43997c8d768b716356b659556b0fe8030f007accdb3f00de0d5d; output-bytes=264; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/budget-engine; path=6dc919bb4189/22 entries

- [x] G9: Existe además escritura directa a Google Calendar para el hogar que conecta
      su cuenta, con un evento por compromiso y borrado al saldarse.
  CHECK: node scripts/gates/assert-contains.mjs apps/web/src/server/google/calendar.ts syncCommitments
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=318701c7ce8622f60b0d9469f0d54dcadb31317322aa9207920f7de7a1af2a8c; exit=0; EXPECT=matched; output-sha256=62544ad5cfa6ff12fc34b7d1fe0a68596e9cd863d5df85c099b4d797b9ef3ff2; output-bytes=75; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G10: Las tres decisiones aprobadas quedan aplicadas: el descuento de planilla lo
      leen los motores, las cifras fiscales se muestran, y el TOS queda revisado.
  CHECK: node scripts/gates/assert-decisions.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=8e2b55076d974e479122f4b03a6c3da4f363bd3a4261c46479616ccf4505fdf8; exit=0; EXPECT=matched; output-sha256=cb0d411a9d6823a1a2893c2834e1e225e2212237f39b3a85e1d395479c408302; output-bytes=385; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G11: Ninguna cadena visible queda fuera de los diccionarios, y es/en tienen las
      mismas claves.
  CHECK: pnpm exec vitest run messages
  EXPECT: 1 passed (1)
  CWD: apps/web
  EVIDENCE: automatic-evidence=v1; definition-sha256=77e643b8edc69f03813ebed0eb367b4e6b835f6c77d49ccba2ece4ef89f90792; exit=0; EXPECT=matched; output-sha256=8eaec160c22803b437eb5a916d2ed55c1278e0c21266dd408bd498c5cdf7f236; output-bytes=250; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/apps/web; path=6dc919bb4189/22 entries

- [x] G12: El gate completo del repositorio pasa: lint, typecheck y test.
  CHECK: node scripts/gates/full-gate.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1b4bacfe182c2ac5af1fc0fced2b38d719640b07b54c48e4a1cc9f6e0baaaea; exit=0; EXPECT=matched; output-sha256=1342e855037647dfc0d4a1440eec92e9dca525c8b70a02dacf9aa1cd9c34a81e; output-bytes=31304; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries
