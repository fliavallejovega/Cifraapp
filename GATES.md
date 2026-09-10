# Gates: el flujo completo de importación

OWNS: apps/web/src/**, packages/transaction-engine/src/**, packages/category-engine/src/**, packages/database/src/schema/**, supabase/migrations/**, apps/web/messages/**, scripts/gates/**

Scope: al subir un estado de cuenta —archivo o escaneo— cada movimiento se cruza
contra todo lo que el hogar ya registró (incluido lo que otra persona anotó a
mano en otra cuenta), se propone una categoría antes de confirmar, un pago a una
contraparte descuenta de lo que se le debe, y toda fila que el sistema no
entienda entra a un asistente donde se clasifica o se crea el rubro.

- [x] G1: El conjunto de comparación de una importación abarca el hogar entero, no una sola cuenta, y las coincidencias de otra cuenta viajan con el nombre de esa cuenta
      CHECK: node scripts/gates/assert-household-scope.mjs
      EXPECT: HOUSEHOLD SCOPE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=b8984555af9fa06408bb0d57e9745696ca3a48f834c32da3535e1b893785bf9f; exit=0; EXPECT=matched; output-sha256=0310234580d4ce2721db1c366a14902707a995dc383e2d2513327f0743e9f9b7; output-bytes=19; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G2: El esquema puede expresar «le debemos $1,800 a Giovanni» — una deuda con contraparte que no es una persona del hogar ni una cuenta bancaria
      CHECK: node scripts/gates/assert-counterparty-debt.mjs
      EXPECT: COUNTERPARTY DEBT OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=e4a0a1a32fdaf29a4a75c3231272b6e2087022a4a8504f3de5fc68d94bf0994a; exit=0; EXPECT=matched; output-sha256=03b2fc0ed876c8fe1c7c7934ddd7786e3d24b6b182b4436e9f96a41133c09fe7; output-bytes=21; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G3: Aplicar un movimiento a una deuda de contraparte reduce su saldo por el monto exacto, deja rastro de quién y desde qué movimiento, y se puede deshacer
      CHECK: node scripts/gates/assert-debt-application.mjs
      EXPECT: DEBT APPLICATION OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=39c8f75462e6f2825e5796b8fe8bda72458a4db720e7f27aadcbe032c87e4a24; exit=0; EXPECT=matched; output-sha256=11d84eb78db0c33c7e924790f42ba984eef11844e8eaed503f2feb6bffbeda84; output-bytes=20; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G4: La IA puede subir un par a revisión pero nunca archivarlo ni descartarlo sola; su veredicto viaja marcado como suyo
      CHECK: node scripts/gates/assert-ai-cannot-decide.mjs
      EXPECT: AI CANNOT DECIDE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=7a85066742293fd0472db79e7b5b2d2e2ff359b1ec0718f1f2da6879cc2d642d; exit=0; EXPECT=matched; output-sha256=123c46ec6aa7a7f00a6d1c534afb0285fbb4c62a8d4f7957e5a223b0737cb96a; output-bytes=20; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G5: Los alias de comercio se leen de la base en las dos rutas que los usaban vacíos, y un alias declarado hace coincidir un comercio que sin él no coincidiría
      CHECK: node scripts/gates/assert-aliases-live.mjs
      EXPECT: ALIASES LIVE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=a6d5fb08c2782762a552930199aa3915e3d144b58910d97a66e4a37a7589d4a8; exit=0; EXPECT=matched; output-sha256=44ac7ffb643190f89696690f886b2686fd98a8a320a327eec7c60bd71939ff05; output-bytes=16; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G6: Cada fila llega a la pantalla de revisión con su categoría propuesta y el efecto sobre el presupuesto del mes, antes de confirmar
      CHECK: node scripts/gates/assert-category-before-confirm.mjs
      EXPECT: CATEGORY BEFORE CONFIRM OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=5aa959bc54c0d84ec6ff31595103fd1d24df04d1ee01620c82b2b84e1c6b5f0c; exit=0; EXPECT=matched; output-sha256=0f6835534272d907fce11bccaecb66d7d8e198ca5e610d950e8ffeb39bf6b592; output-bytes=27; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G7: El asistente de revisión permite cambiar la categoría de una fila y crear un rubro nuevo sin salir, y ninguna fila queda sin cola
      CHECK: node scripts/gates/assert-review-wizard.mjs
      EXPECT: REVIEW WIZARD OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=2f934c220b86d6e99e2db91e77e6ff4cafbd8e2e77c13ef1a5b4a965186f9806; exit=0; EXPECT=matched; output-sha256=c1ad776df42535c58c7a5d49c9e2cad8f1435e6788219962a9815aed4e80a1e6; output-bytes=17; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G8: Toda migración nueva de esta tanda está aplicada y verificada contra la base real, no dada por hecho
      CHECK: node scripts/gates/assert-migrations-applied.mjs
      EXPECT: MIGRATIONS APPLIED OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=1630827e17f61129e924a0088c0193255825541c8edb66d5f73388ab5afc0168; exit=0; EXPECT=matched; output-sha256=bf4682df3bacf197191acca26cede09d543c707545c0a7df52a6b2f151bdb952; output-bytes=22; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G9: El gate del repositorio entero pasa: lint, typecheck, pruebas y build
      CHECK: node scripts/gates/full-gate.mjs
      EXPECT: FULL GATE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=955fbfb6a060b7e483ed27eeaca9077ab7fb59e5f72f040fdc2380ee1ace1b85; exit=0; EXPECT=matched; output-sha256=ad1d4cb750f8d5773f9694a5612fab5adec1e3632f5ab4884901d7086b3d8e67; output-bytes=43047; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G11: Después de cada importación el sistema dice qué documentos faltan, por cuenta y por mes, nombrando la cuenta por sus últimos cuatro dígitos
      CHECK: node scripts/gates/assert-coverage-gaps.mjs
      EXPECT: COVERAGE GAPS OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=ed7c890f2c0cc76273146adec3b8a1ee361a1aeb4b30d43808a5273d3f8ce2ba; exit=0; EXPECT=matched; output-sha256=7894554e3e47953f53912ce6ce933800268f1960ffc69902b4c113d2cd9c03a1; output-bytes=17; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G12: Un pago a tarjeta de crédito reconocido en un estado de cuenta baja el saldo de esa tarjeta, y no se cuenta como gasto
      CHECK: node scripts/gates/assert-card-payment.mjs
      EXPECT: CARD PAYMENT OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=a5206ed0e34190bb893d82a179977152b5ba3d761b8096761585c5f5d7a52f3f; exit=0; EXPECT=matched; output-sha256=dcac40b69d19f12e864f36da33aa63ae24ca8454f0813c693969298e5f14d243; output-bytes=16; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] G10: Cada clave de copy que una pantalla pide existe en español y en inglés
      CHECK: node scripts/gates/assert-copy-complete.mjs
      EXPECT: COPY COMPLETE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=5e309be5ae4a100797b328ec35481e5a01f0b73f7e31e7690e1b2ee42a778432; exit=0; EXPECT=matched; output-sha256=b762b20bc4464eca1d84f3b89f3bb2c201b5ba35f6f6b57a8c3fec60c8b5c19b; output-bytes=17; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

<!--
Cada gate negativo (G4) se comprueba contra un control positivo conocido antes
de confiar en su ausencia. El control queda anotado en la evidencia del gate.
-->
