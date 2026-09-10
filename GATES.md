# Gates: catálogo de tarjetas de Panamá, comparativo y refresco mensual

OWNS: apps/web/**, packages/**, supabase/migrations/**, scripts/**, docs/**

Scope: un catálogo de las tarjetas de Panamá —crédito y débito, de todos los
bancos, tenga el hogar cuenta ahí o no— con la procedencia de cada línea; las
**promociones del mes** con sus comercios; una pantalla que las compara y las
filtra por lo que el hogar de verdad tiene; y un barrido mensual que vuelve a
leer las fuentes oficiales y sube lo nuevo sin presentarlo como confirmado.

- [x] G1: Toda fila del catálogo tiene fuente, dirección y fecha de lectura. Ninguna
      línea sin procedencia entra a la base.
  CHECK: node scripts/gates/assert-catalogue-provenance.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=4d47254cbfdca6d13986004e66e161df7069fa82a661962b7c17af0945d8c354; exit=0; EXPECT=matched; output-sha256=c3917e1311aefab06137639e3120d6c07120b00333539d1a6d74d3a83d0f9d77; output-bytes=73; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G2: La cobertura por banco está declarada: cada institución sembrada aparece
      cubierta o explícitamente pendiente, y la pantalla lo dice.
  CHECK: node scripts/gates/assert-catalogue-coverage.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=9776459f1b730abd3c01cd24fcef69e3dc4e3c744ed11f86e6faf5f0cf4a8fd5; exit=0; EXPECT=matched; output-sha256=7da728234f2219386bd7f44164c21b8e5d97529954812c24a56ba95d55327404; output-bytes=267; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G3: El comparativo ordena las tarjetas por lo que devuelven en una categoría
      y no inventa un ganador donde no hay dato.
  CHECK: pnpm exec vitest run card-compare
  EXPECT: 1 passed (1)
  CWD: packages/budget-engine
  EVIDENCE: automatic-evidence=v1; definition-sha256=c9260b68ca4f8d1951963c1d90b33738faf418346fcda4e9cd2eecac5f00149f; exit=0; EXPECT=matched; output-sha256=eefb41e1b945cd2fb04398aa237df76d09ba9c97ea224996138c45161a790785; output-bytes=264; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/packages/budget-engine; path=6dc919bb4189/22 entries

- [x] G4: El refresco mensual existe, vuelve a leer cada fuente, compara contra la
      huella guardada y marca lo que cambió sin reescribir el dato.
  CHECK: pnpm exec vitest run catalogue-refresh
  EXPECT: 1 passed (1)
  CWD: apps/web
  EVIDENCE: automatic-evidence=v1; definition-sha256=adc1312be085a2dccd7c13158d92108ddd35e0b93f7d31016b1d125deb023452; exit=0; EXPECT=matched; output-sha256=7311ec2e8d32cf4a8201344ee653b72df7815782556ebe01891b018217988ae1; output-bytes=248; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/apps/web; path=6dc919bb4189/22 entries

- [x] G5: La pantalla de tarjetas enseña el comparativo y la frescura de cada línea.
  CHECK: node scripts/gates/assert-contains.mjs 'apps/web/src/app/[locale]/(product)/cards/page.tsx' CardCompare
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=175dd800aae207f8756b7b4252beb6674a4e7dd8238371601298e17830950cc1; exit=0; EXPECT=matched; output-sha256=b6efa63224b5159da57951e3b01fb38541fdb96d4334b533c14f2679439988e1; output-bytes=83; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G6: Las migraciones nuevas están aplicadas en la base real, no sólo escritas.
  CHECK: node scripts/gates/assert-migrations-applied.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=1754af94cbe3537be5f508ae8db8da7a80ba2b3c4dc40556fce0078135e4f36f; exit=0; EXPECT=matched; output-sha256=2c1c84e0707137329730accff039a1ec45c4210885be70f17d64dc2a91a36d75; output-bytes=113; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G7: Las promociones del mes existen como dato propio —comercio, descuento,
      días, vigencia— separado de los beneficios permanentes del contrato.
  CHECK: node scripts/gates/assert-contains.mjs supabase/migrations/20260910130000_card_promotions.sql merchant_name
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=12eccecf4ecded57e872ef62da99857091e7a032dc1e3ac564a0f448a03c2eb9; exit=0; EXPECT=matched; output-sha256=2aafe343694b6fbc4d03f862e5762c2b9650234905b01d0bc304dae50712561e; output-bytes=89; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G8: El barrido mensual extrae promociones de las páginas oficiales y las sube
      marcadas como no confirmadas, nunca como hecho.
  CHECK: pnpm exec vitest run promotion-extract
  EXPECT: 1 passed (1)
  CWD: apps/web
  EVIDENCE: automatic-evidence=v1; definition-sha256=ce6472e0f5ebaee5ff98517422ae4382c639f8bc7eb2d9e0d9d7e2491940cec3; exit=0; EXPECT=matched; output-sha256=b3698006969ab5448c871ed515843af7998542c7fd2593904a6904c7166e97e6; output-bytes=250; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar/apps/web; path=6dc919bb4189/22 entries

- [x] G9: La pantalla de ofertas incluye débito y otros bancos, y filtra por lo que
      el hogar tiene sin esconder el resto.
  CHECK: node scripts/gates/assert-contains.mjs 'apps/web/src/app/[locale]/(product)/offers/page.tsx' onlyMine
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=6e03ffc7ddb0802e26c733f603c1f5e3415d20e6a239d6a0e5f7857a85db642b; exit=0; EXPECT=matched; output-sha256=023a9e721a32fa0f0bb6336450f74899597ac759a5a1a23fd48595c4799b74d5; output-bytes=81; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G10: El gate del repositorio pasa: lint, typecheck y test.
  CHECK: node scripts/gates/full-gate.mjs
  EXPECT: GATE OK
  EVIDENCE: automatic-evidence=v1; definition-sha256=d1b4bacfe182c2ac5af1fc0fced2b38d719640b07b54c48e4a1cc9f6e0baaaea; exit=0; EXPECT=matched; output-sha256=72d33431d108261463fc8bff248ba7087a8d2bff7e30737787333992b812eb24; output-bytes=31557; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries
