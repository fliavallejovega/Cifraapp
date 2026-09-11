# Gates: el lenguaje visual de los correos y su módulo de edición

OWNS: packages/email/**, apps/admin/src/**, apps/web/src/server/notification-service.ts, apps/web/src/server/mail.ts, apps/web/src/server/reminders.ts, packages/database/src/schema/**, packages/validation/src/env/**, supabase/migrations/**, scripts/gates/**, scripts/check-brevo.mjs

Scope: todo correo que sale de Cifraapp —los avisos por Brevo y los de cuenta
por Supabase— comparte un solo lenguaje visual derivado de DESIGN.md, se
escribe en español primero, y se puede ver, editar, probar, versionar y
publicar desde la consola sin tocar HTML y sin poder dejar a nadie afuera.

- [x] E1: El paquete de correo renderiza con sus pruebas en verde, incluida la que inyecta HTML en cada campo y en cada variable
      CHECK: node scripts/gates/assert-email-package.mjs
      EXPECT: EMAIL PACKAGE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=9497947dab32dbb848f407594fe190c85aceaed771cd0009820037c37c50a1ad; exit=0; EXPECT=matched; output-sha256=b29d1d2ff62b0f62c1d739478716a001a9433b692b5c9a7dfe644f1699ea9e98; output-bytes=30; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E2: Cada plantilla del catálogo renderiza en español y en inglés con texto plano, preheader, colores en hex y menos de 102 KB
      CHECK: node scripts/gates/assert-email-templates-render.mjs
      EXPECT: EMAIL TEMPLATES RENDER OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=f80fbcb129036c243c54ad50b71bc2a189f6a3f180389ad330c6855320427583; exit=0; EXPECT=matched; output-sha256=b4dc4e2cc263bf907d1f1c18233248be823b319a54cc499f94fb9738092b14d3; output-bytes=67; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E3: Una plantilla de cuenta no se puede guardar sin el enlace o el código que la hace funcionar
      CHECK: node scripts/gates/assert-email-lockout-guard.mjs
      EXPECT: LOCKOUT GUARD OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=055898847bcfdb9252c8874fa73c84e92d0acef29e7b9970b4114145152aaac7; exit=0; EXPECT=matched; output-sha256=1ffae62439c91e5522c6a5ca5aaf4ca7fe6b303eb37df422728743c03cdd5960; output-bytes=59; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E4: Todo texto del correo cumple contraste AA sobre su fondo, en claro y en oscuro
      CHECK: node scripts/gates/assert-email-contrast.mjs
      EXPECT: EMAIL CONTRAST OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=682d91ba2f6c48ac2fb24f7b7f075f048fcb9833da5101373518cfa79e630bfe; exit=0; EXPECT=matched; output-sha256=a9e53cd43a4c998e43090bf282256ea89f197febfe772c679e04ad9c31e897d7; output-bytes=396; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E5: Las tablas de plantillas y de versiones existen en la base real
      CHECK: node scripts/gates/assert-email-migrations.mjs
      EXPECT: EMAIL MIGRATIONS OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=db48b16ff96a91564c6dbf704bb4453d9f39c29efaf58ca73204b03441f3f0ca; exit=0; EXPECT=matched; output-sha256=f0309fe282b655814d27f0db6753a509b3e2bc9df4b100c449a9a391e63819e1; output-bytes=20; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E6: Los avisos de la app salen con HTML y texto desde el catálogo, con lo editado en la consola ganando sobre el valor de fábrica
      CHECK: node scripts/gates/assert-email-wired.mjs
      EXPECT: EMAIL WIRED OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=5134b9a4bb2d227acb59f68117fa7a827ae5c3be1f035c282279fe8c43a1ffdf; exit=0; EXPECT=matched; output-sha256=027a899d7b5d92367d26556876a481b52205d9b84bfb0c043f3bd9db5ec02d6e; output-bytes=15; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E7: Toda escritura del módulo de correos exige rol de contenido y queda en la auditoría con el antes y el después
      CHECK: node scripts/gates/assert-email-admin-audited.mjs
      EXPECT: EMAIL ADMIN AUDITED OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=98a20f762617d4914c699218be928b357fa3c83183cc3c13f17e54c07a341ff9; exit=0; EXPECT=matched; output-sha256=e57f13dc6ec926947841f18aff5f166631e17fb9c9047eb553f658b856bd0eed; output-bytes=36; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E8: Ninguna función cruza de servidor a cliente, ni en la app ni en la consola
      CHECK: node scripts/gates/assert-no-functions-cross-the-boundary.mjs
      EXPECT: NO FUNCTIONS CROSS OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=aa4ef57e369b7a62dcdd41ed25a6fa2b20f2ed28a7495aeb0d22c3ffa9f3322a; exit=0; EXPECT=matched; output-sha256=7e3473e2cbd760ab77fa7f47748e1dabbad583053f6d46945632914927272526; output-bytes=98; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [x] E9: El gate del repositorio pasa entero, incluida la consola
      CHECK: node scripts/gates/full-gate.mjs
      EXPECT: FULL GATE OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=955fbfb6a060b7e483ed27eeaca9077ab7fb59e5f72f040fdc2380ee1ace1b85; exit=0; EXPECT=matched; output-sha256=f016a4ac8b8ba0145dc1b30a13433e7b5e92e4a8a869ec1766eb57c7d613e513; output-bytes=44731; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries

- [ ] E10: Las plantillas de cuenta publicadas en Supabase son exactamente las que renderiza el catálogo
      CHECK: node scripts/gates/assert-supabase-templates-published.mjs
      EXPECT: SUPABASE TEMPLATES PUBLISHED OK
      EVIDENCE: pending

- [x] E11: Un correo con el diseño nuevo sale por Brevo y queda entregado
      CHECK: node scripts/gates/assert-brevo-delivered.mjs
      EXPECT: BREVO DELIVERED OK
      EVIDENCE: automatic-evidence=v1; definition-sha256=4f006c281ad22856462fcd35faad8ce956a642e1044246f6d3a064b2dc365337; exit=0; EXPECT=matched; output-sha256=d10f6e1d1102a490c5c2cb353e3a9e9d4a15644acaf2ba649b1d1c1046aa22f8; output-bytes=69; shell=/bin/sh; cwd=/Users/javiervallejo/Documents/Websites/Accounting familiar; path=6dc919bb4189/22 entries
