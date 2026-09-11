# Gates: el lenguaje visual de los correos y su módulo de edición

OWNS: packages/email/**, apps/admin/src/**, apps/web/src/server/notification-service.ts, apps/web/src/server/mail.ts, apps/web/src/server/reminders.ts, packages/database/src/schema/**, packages/validation/src/env/**, supabase/migrations/**, scripts/gates/**, scripts/check-brevo.mjs

Scope: todo correo que sale de Cifraapp —los avisos por Brevo y los de cuenta
por Supabase— comparte un solo lenguaje visual derivado de DESIGN.md, se
escribe en español primero, y se puede ver, editar, probar, versionar y
publicar desde la consola sin tocar HTML y sin poder dejar a nadie afuera.

- [ ] E1: El paquete de correo renderiza con sus pruebas en verde, incluida la que inyecta HTML en cada campo y en cada variable
      CHECK: node scripts/gates/assert-email-package.mjs
      EXPECT: EMAIL PACKAGE OK
      EVIDENCE: pending

- [ ] E2: Cada plantilla del catálogo renderiza en español y en inglés con texto plano, preheader, colores en hex y menos de 102 KB
      CHECK: node scripts/gates/assert-email-templates-render.mjs
      EXPECT: EMAIL TEMPLATES RENDER OK
      EVIDENCE: pending

- [ ] E3: Una plantilla de cuenta no se puede guardar sin el enlace o el código que la hace funcionar
      CHECK: node scripts/gates/assert-email-lockout-guard.mjs
      EXPECT: LOCKOUT GUARD OK
      EVIDENCE: pending

- [ ] E4: Todo texto del correo cumple contraste AA sobre su fondo, en claro y en oscuro
      CHECK: node scripts/gates/assert-email-contrast.mjs
      EXPECT: EMAIL CONTRAST OK
      EVIDENCE: pending

- [ ] E5: Las tablas de plantillas y de versiones existen en la base real
      CHECK: node scripts/gates/assert-email-migrations.mjs
      EXPECT: EMAIL MIGRATIONS OK
      EVIDENCE: pending

- [ ] E6: Los avisos de la app salen con HTML y texto desde el catálogo, con lo editado en la consola ganando sobre el valor de fábrica
      CHECK: node scripts/gates/assert-email-wired.mjs
      EXPECT: EMAIL WIRED OK
      EVIDENCE: pending

- [ ] E7: Toda escritura del módulo de correos exige rol de contenido y queda en la auditoría con el antes y el después
      CHECK: node scripts/gates/assert-email-admin-audited.mjs
      EXPECT: EMAIL ADMIN AUDITED OK
      EVIDENCE: pending

- [ ] E8: Ninguna función cruza de servidor a cliente, ni en la app ni en la consola
      CHECK: node scripts/gates/assert-no-functions-cross-the-boundary.mjs
      EXPECT: NO FUNCTIONS CROSS OK
      EVIDENCE: pending

- [ ] E9: El gate del repositorio pasa entero, incluida la consola
      CHECK: node scripts/gates/full-gate.mjs
      EXPECT: FULL GATE OK
      EVIDENCE: pending

- [ ] E10: Las plantillas de cuenta publicadas en Supabase son exactamente las que renderiza el catálogo
      CHECK: node scripts/gates/assert-supabase-templates-published.mjs
      EXPECT: SUPABASE TEMPLATES PUBLISHED OK
      EVIDENCE: pending

- [ ] E11: Un correo con el diseño nuevo sale por Brevo y queda entregado
      CHECK: node scripts/gates/assert-brevo-delivered.mjs
      EXPECT: BREVO DELIVERED OK
      EVIDENCE: pending
