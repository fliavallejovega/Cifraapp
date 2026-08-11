-- The marketing site's content.
--
-- Spanish is written first and English second, because that is the order the
-- product is built in and a translated-from-English Spanish page reads like one.
--
-- Everything here is a claim the product can support today. Where it cannot —
-- a support address, a company history, a customer — the page says so in place
-- of inventing it, and the item goes on the replacement list rather than into
-- the copy (spec §108).

insert into platform.content_pages
  (kind, slug, locale, title, excerpt, body, status, published_at, seo_title, seo_description, sort_order)
values
-- ---------------------------------------------------------------------------
-- Qué hace / What it does
-- ---------------------------------------------------------------------------
('page', 'features', 'es',
 'Qué hace',
 'Ordena lo que ya pasó, y después te dice qué hacer con lo que queda.',
 '## Entra tu información sin duplicarse

Subes un estado de cuenta en CSV u OFX y el sistema calcula una huella para cada movimiento a partir de la cuenta, la fecha, el monto y la descripción normalizada. Si vuelves a subir el mismo archivo, no pasa nada. Si el banco cambia el formato de la descripción, tampoco.

## Reconoce lo que no es un gasto

Un pago de tarjeta, un traspaso a ahorros y un retiro de efectivo mueven dinero entre cosas que ya son tuyas. El sistema los detecta como traspasos y los deja fuera de ingresos y gastos. Contarlos duplicaría cada compra que ya está en la tarjeta.

## Aprende de tus correcciones

Cuando corriges una categoría, el sistema no solo cambia esa transacción: guarda la regla que implica y la aplica a la siguiente. Puedes ver esas reglas, editarlas y borrarlas.

## Calcula qué queda de verdad

Del saldo se descuentan las obligaciones próximas, los pagos mínimos de deuda, la reserva fiscal estimada y tu colchón mínimo. Lo que queda es lo disponible, y cada descuento está listado con su motivo.

## Dice qué hacer con el próximo dólar

Un plan concreto, línea por línea, en un orden que puedes cambiar: lo vencido primero, después lo que vence pronto, después los mínimos de deuda, la reserva fiscal, el colchón, la deuda cara, las metas. Cada línea explica por qué está donde está.',
 'published', now(), 'Qué hace', 'Importación sin duplicados, detección de traspasos, categorización que aprende, disponible real y un plan concreto para tu próximo dólar.', 1),

('page', 'features', 'en',
 'What it does',
 'It puts what already happened in order, then tells you what to do with what is left.',
 '## Your information goes in without duplicating

You upload a statement as CSV or OFX and the system computes a fingerprint for every movement from the account, the date, the amount and the normalized description. Upload the same file again and nothing happens. Change the bank''s description format and nothing happens either.

## It knows what is not spending

A card payment, a transfer to savings and a cash withdrawal all move money between things that are already yours. The system detects them as transfers and leaves them out of income and expenses. Counting them would double every purchase already on the card.

## It learns from your corrections

When you correct a category the system does not just change that transaction: it records the rule that correction implies and applies it to the next one. You can read those rules, edit them and delete them.

## It works out what is genuinely left

Upcoming obligations, minimum debt payments, the estimated tax reserve and your buffer are deducted from the balance. What remains is available, and every deduction is listed with its reason.

## It says what the next dollar should do

A concrete plan, line by line, in an order you can change: overdue first, then due soon, then debt minimums, the tax reserve, the buffer, expensive debt, goals. Every line explains why it sits where it sits.',
 'published', now(), 'What it does', 'Imports without duplicates, transfer detection, categorization that learns, a real available figure, and a concrete plan for your next dollar.', 1),

-- ---------------------------------------------------------------------------
-- Independientes / Independents
-- ---------------------------------------------------------------------------
('page', 'independents', 'es',
 'Para profesionales independientes',
 'El ingreso llega completo y se siente disponible. Casi nunca lo está.',
 '## El problema no es ganar poco

Es que el dinero entra de una vez y sale poco a poco, y el impuesto llega meses después contra un dinero que ya se gastó. Un mes bueno y un mes malo se ven iguales en la cuenta el día 3.

## La reserva fiscal

Cada vez que entra un ingreso, el sistema aparta una parte estimada y la saca de lo disponible. No es un cálculo de lo que debes: es una reserva, y así se llama en toda la aplicación. Cuando existan reglas fiscales revisadas para tu jurisdicción, la reserva se calculará con ellas y se guardará la versión que la produjo.

## Gastos personales y de negocio

Cada gasto se clasifica como personal, de negocio, mixto o pendiente de revisar. El sistema nunca marca algo como deducible por su cuenta: propone, y tú confirmas. Un gasto mixto lleva el porcentaje que tú decides, no uno que inventamos.

## Cuánto tiempo aguantas

Con ingresos irregulares, la pregunta útil no es cuánto tienes sino cuántos meses cubres. El sistema proyecta el efectivo mes a mes y marca el primero en el que te quedarías corto.',
 'published', now(), 'Para profesionales independientes',
 'Reserva fiscal estimada desde el día que entra el ingreso, clasificación de gastos personales y de negocio, y proyección de cuántos meses aguantas.', 2),

('page', 'independents', 'en',
 'For independent professionals',
 'Income arrives in full and feels available. It almost never is.',
 '## The problem is not earning too little

It is that money arrives at once and leaves gradually, and the tax lands months later against money that is already spent. A good month and a bad month look identical in the account on the 3rd.

## The tax reserve

Every time income arrives the system sets an estimated portion aside and takes it out of what is available. It is not a calculation of what you owe: it is a reserve, and it is called that everywhere in the application. Once reviewed tax rules exist for your jurisdiction the reserve will be computed from them, and the version that produced it is stored with the figure.

## Personal and business expenses

Every expense is classified as personal, business, mixed or needing review. The system never marks something deductible on its own: it proposes and you confirm. A mixed expense carries the percentage you decide, not one we invented.

## How long you last

With irregular income the useful question is not how much you have but how many months you cover. The system projects cash month by month and marks the first one where you would fall short.',
 'published', now(), 'For independent professionals',
 'An estimated tax reserve from the day income lands, personal and business expense classification, and a projection of how many months you last.', 2),

-- ---------------------------------------------------------------------------
-- Parejas / Couples
-- ---------------------------------------------------------------------------
('page', 'couples', 'es',
 'Para parejas y familias',
 'Finanzas que se administran juntas sin que nadie pierda lo suyo.',
 '## Un hogar, no una cuenta compartida

Un hogar agrupa las finanzas que se administran juntas. Cada cuenta, cada transacción y cada meta tiene un alcance: personal, de tu pareja, del hogar o del negocio. Tú decides qué entra en el cálculo común.

## Lo que ambos ven

El disponible del hogar, lo que está comprometido y el plan del próximo dinero. Ese cálculo solo tiene sentido si es el mismo para las dos personas, y la discusión deja de ser sobre las cifras para ser sobre las decisiones.

## Lo que no se comparte por defecto

Nada se comparte porque sí. Un gasto personal marcado como personal se queda personal, y el sistema no lo expone en la vista del hogar.',
 'published', now(), 'Para parejas y familias',
 'Un hogar con alcances por cuenta y por transacción: lo común se calcula junto y lo personal sigue siendo personal.', 3),

('page', 'couples', 'en',
 'For couples and families',
 'Finances managed together without either person losing what is theirs.',
 '## A household, not a joint account

A household groups the finances that are managed together. Every account, transaction and goal carries a scope: personal, your partner''s, the household''s, or the business''s. You decide what enters the shared calculation.

## What you both see

The household''s available figure, what is committed, and the plan for the next money. That calculation is only useful if it is the same for both people, and the conversation stops being about the numbers and starts being about the decisions.

## What is not shared by default

Nothing is shared automatically. A personal expense marked personal stays personal, and the system does not surface it in the household view.',
 'published', now(), 'For couples and families',
 'A household with scopes per account and per transaction: what is shared is computed together and what is personal stays personal.', 3),

-- ---------------------------------------------------------------------------
-- Contadores / Accountants
-- ---------------------------------------------------------------------------
('page', 'accountants', 'es',
 'Para contadores',
 'Acceso explícito, con alcance definido y revocable en cualquier momento.',
 '## Nadie obtiene acceso automáticamente

Un contador no ve un hogar hasta que ese hogar se lo concede, y el permiso dice exactamente qué alcanza: solo lectura, lectura y comentarios, o la capacidad de clasificar. El hogar puede revocarlo sin avisar a nadie y sin explicaciones.

## Lo que verás

El estado de cada cliente, qué está sin categorizar, qué duplicados quedaron sin resolver, qué meses están cerrados y cuáles no, y los documentos que el hogar decidió compartir.

## Lo que el sistema no hace

No prepara declaraciones y no sustituye tu criterio. Las cifras fiscales que muestra son estimaciones, llevan la versión de las reglas con las que se calcularon, y no aparecen hasta que esas reglas han sido revisadas por alguien calificado.',
 'published', now(), 'Para contadores',
 'Acceso explícito y revocable a los hogares que te lo conceden, con el estado de cada cliente y sin sustituir tu criterio profesional.', 4),

('page', 'accountants', 'en',
 'For accountants',
 'Explicit access, with a defined scope, revocable at any time.',
 '## Nobody gains access automatically

An accountant does not see a household until that household grants it, and the grant states exactly what it reaches: read only, read and comment, or the ability to classify. The household can revoke it without notice and without explaining why.

## What you will see

Each client''s state: what is uncategorized, which duplicates were left unresolved, which months are closed and which are not, and the documents the household chose to share.

## What the system does not do

It does not prepare returns and it does not replace your judgement. The tax figures it shows are estimates, they carry the version of the rules that produced them, and they do not appear until those rules have been reviewed by somebody qualified.',
 'published', now(), 'For accountants',
 'Explicit, revocable access to the households that grant it, with each client''s state, and without replacing your professional judgement.', 4),

-- ---------------------------------------------------------------------------
-- Seguridad / Security
-- ---------------------------------------------------------------------------
('page', 'security', 'es',
 'Seguridad',
 'Qué protege tus datos y qué no podemos prometerte todavía.',
 '## El aislamiento entre hogares lo hace la base de datos

Cada tabla con datos de clientes tiene seguridad a nivel de fila activada y forzada, y las políticas se evalúan contra la identidad de quien consulta. La aplicación no filtra por inquilino en su propio código: eso no sería seguridad, sería una convención.

## Los documentos son privados

Un estado de cuenta se guarda en almacenamiento privado y solo se lee a través de un enlace firmado que caduca en cinco minutos. No hay una URL pública de tus documentos.

## La sesión no se contagia entre peticiones

Las credenciales de quien consulta se fijan dentro de la transacción y se descartan cuando termina, así que una conexión reutilizada no puede llevar la identidad de una persona a la petición de otra.

## Lo que todavía no tenemos

No hay verificación en dos pasos, ni acceso con proveedores externos, ni una auditoría de seguridad externa. Cuando existan, se dirá aquí con su fecha. Un producto financiero que enumera medidas que no tiene ya te dijo lo que es.',
 'published', now(), 'Seguridad',
 'Aislamiento entre hogares impuesto por la base de datos, documentos privados con enlaces firmados, y una lista honesta de lo que todavía falta.', 5),

('page', 'security', 'en',
 'Security',
 'What protects your data, and what we cannot promise you yet.',
 '## The database enforces isolation between households

Every table holding customer data has row-level security enabled and forced, and the policies are evaluated against the identity of whoever is asking. The application does not filter by tenant in its own code: that would not be security, it would be a convention.

## Documents are private

A statement is stored in private object storage and read only through a signed link that expires in five minutes. There is no public URL for your documents.

## A session cannot leak between requests

The caller''s credentials are set inside the transaction and discarded when it ends, so a reused connection cannot carry one person''s identity into another person''s request.

## What we do not have yet

There is no two-step verification, no sign-in with external providers, and no external security audit. When those exist this page will say so, with the date. A financial product that lists measures it does not have has already told you what it is.',
 'published', now(), 'Security',
 'Isolation between households enforced by the database, private documents behind signed links, and an honest list of what is still missing.', 5),

-- ---------------------------------------------------------------------------
-- Quiénes somos / About
-- ---------------------------------------------------------------------------
('page', 'about', 'es',
 'Quiénes somos',
 'Un producto en construcción, con las decisiones a la vista.',
 '## Por qué existe

La mayoría de las aplicaciones de finanzas personales reportan lo que ya pasó. Ordenan, categorizan, hacen una gráfica y dejan la decisión donde estaba: en la cabeza de quien mira la pantalla. Este producto existe para responder la pregunta siguiente — qué debería hacer este dinero — y para responderla con un cálculo que se puede revisar línea por línea.

## Cómo está construido

Sin decimales flotantes en el dinero. Sin fechas con hora donde lo que importa es el día. Sin que la inteligencia artificial decida un saldo, un impuesto o un permiso. Sin borrar información financiera en silencio. Cada una de esas reglas está escrita en el repositorio y hay pruebas que fallan si se rompen.

## Lo que todavía no somos

No hay equipo público, no hay historia de compañía y no hay clientes. Cuando los haya, se dirá aquí. Mientras tanto, esta página prefiere estar corta a estar inventada.',
 'published', now(), 'Quiénes somos',
 'Por qué existe este producto, cómo está construido, y qué todavía no puede decir de sí mismo.', 6),

('page', 'about', 'en',
 'About',
 'A product under construction, with its decisions in the open.',
 '## Why it exists

Most personal finance software reports what already happened. It sorts, categorizes, draws a chart, and leaves the decision exactly where it was: in the head of the person looking at the screen. This product exists to answer the next question — what should this money do — and to answer it with a calculation that can be checked line by line.

## How it is built

No floating point on money. No timestamps where what matters is a calendar day. No AI deciding a balance, a tax figure or a permission. No financial information destroyed silently. Every one of those rules is written down in the repository, and there are tests that fail when one is broken.

## What we are not yet

There is no public team, no company history and no customers. When there are, this page will say so. Until then it would rather be short than invented.',
 'published', now(), 'About',
 'Why this product exists, how it is built, and what it cannot yet say about itself.', 6),

-- ---------------------------------------------------------------------------
-- Contacto / Contact
-- ---------------------------------------------------------------------------
('page', 'contact', 'es',
 'Contacto',
 'Todavía no hay un canal público. Esto es lo que sí existe.',
 '## Desde dentro del producto

Si ya tienes una cuenta, el soporte vive dentro de la aplicación, donde podemos ver el hogar y la transacción de la que hablas sin pedirte capturas de pantalla.

## Desde fuera

Un correo de contacto público todavía no está configurado. Está en la lista de cosas por reemplazar antes de que este sitio se anuncie en cualquier parte, y esta página lo dice en vez de mostrar una dirección que nadie lee.',
 'published', now(), 'Contacto', 'Cómo contactarnos hoy, y qué canal todavía no existe.', 7),

('page', 'contact', 'en',
 'Contact',
 'There is no public channel yet. Here is what does exist.',
 '## From inside the product

If you already have an account, support lives inside the application, where we can see the household and the transaction you are describing without asking you for screenshots.

## From outside

A public contact address is not configured yet. It is on the list of things to replace before this site is advertised anywhere, and this page says so instead of showing an address nobody reads.',
 'published', now(), 'Contact', 'How to reach us today, and which channel does not exist yet.', 7)

on conflict (kind, slug, locale) do nothing;

-- ---------------------------------------------------------------------------
-- Preguntas frecuentes
-- ---------------------------------------------------------------------------

insert into platform.faqs (locale, question, answer, sort_order)
values
  ('es', '¿Se conecta a mi banco?',
   'Todavía no. Hoy importas un estado de cuenta en CSV u OFX, y el sistema se encarga de que subir el mismo archivo dos veces no duplique nada.', 1),
  ('es', '¿Calcula mis impuestos?',
   'Calcula una reserva fiscal estimada y la llama así. No prepara declaraciones y no sustituye a un contador. Las reglas de Panamá están cargadas como borrador y no se muestran hasta que alguien calificado las revise.', 2),
  ('es', '¿Qué hace la inteligencia artificial?',
   'Explica y clasifica. Nunca calcula un saldo, un impuesto, un permiso ni decide si algo es un duplicado. Si una respuesta menciona una cifra que no le dimos, el sistema la descarta.', 3),
  ('es', '¿Puedo sacar mis datos?',
   'Sí, en CSV y JSON, en cualquier momento y sin pedirlo. Los montos salen sin formato para que una hoja de cálculo los lea como números.', 4),
  ('en', 'Does it connect to my bank?',
   'Not yet. Today you import a statement as CSV or OFX, and the system makes sure uploading the same file twice duplicates nothing.', 1),
  ('en', 'Does it calculate my taxes?',
   'It calculates an estimated tax reserve and calls it that. It does not prepare returns and does not replace an accountant. Panama''s rules are loaded as a draft and are not shown until somebody qualified reviews them.', 2),
  ('en', 'What does the AI do?',
   'It explains and it classifies. It never computes a balance, a tax figure or a permission, and never decides whether something is a duplicate. If an answer cites a figure we did not give it, the system discards the answer.', 3),
  ('en', 'Can I get my data out?',
   'Yes, as CSV and JSON, at any time, without asking. Amounts are exported unformatted so a spreadsheet reads them as numbers.', 4)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Legal — drafts, unreviewed
-- ---------------------------------------------------------------------------
--
-- `reviewed_by` and `reviewed_at` are null, and the pages show a notice saying
-- so. These are placeholders that describe what the product actually does; they
-- are not a substitute for documents drafted by counsel, and shipping them
-- silently as though they were would be the exact failure this schema exists to
-- prevent.

insert into platform.legal_documents (kind, locale, version, title, body, effective_from)
values
  ('terms', 'es', '0.1-draft', 'Términos de servicio',
   '## Borrador

Este texto no ha sido revisado por un abogado. Describe lo que el producto hace hoy para que puedas leerlo, no para que sustituya unos términos redactados profesionalmente.

## El servicio

El producto organiza información financiera que tú aportas y produce recomendaciones a partir de ella. No es un banco, no custodia dinero y no ejecuta pagos.

## Tus datos

Son tuyos. Puedes exportarlos en cualquier momento y puedes pedir que se eliminen. Cuando una obligación contable o de auditoría impida borrar algo de inmediato, se te dirá qué se conserva y por qué.

## Sin asesoría

Nada de lo que muestra el producto es asesoría fiscal, legal ni de inversión. Las cifras fiscales son estimaciones y llevan la versión de las reglas con las que se calcularon.', '2026-01-01'),

  ('terms', 'en', '0.1-draft', 'Terms of service',
   '## Draft

This text has not been reviewed by a lawyer. It describes what the product does today so you can read it, not as a substitute for professionally drafted terms.

## The service

The product organizes financial information you provide and produces recommendations from it. It is not a bank, it does not hold money, and it does not execute payments.

## Your data

It is yours. You can export it at any time and you can ask for it to be deleted. Where an accounting or audit obligation prevents immediate deletion, you will be told what is retained and why.

## No advice

Nothing the product shows is tax, legal or investment advice. Tax figures are estimates and carry the version of the rules that produced them.', '2026-01-01'),

  ('privacy', 'es', '0.1-draft', 'Privacidad',
   '## Borrador

Este texto no ha sido revisado por un abogado.

## Qué guardamos

Lo que tú introduces o importas: cuentas, transacciones, documentos y las decisiones que tomas sobre ellos. Y lo mínimo para operar el servicio: tu correo, tus sesiones y un registro de las operaciones sensibles.

## Quién lo ve

Los miembros de tu hogar, y quien tú autorices explícitamente. El aislamiento entre hogares lo impone la base de datos, no el código de la aplicación.

## Documentos

Se guardan en almacenamiento privado y se leen a través de enlaces firmados que caducan en cinco minutos.

## Proveedores

Base de datos y autenticación en Supabase; almacenamiento de documentos en Cloudflare R2. Si activas el asistente, el texto de la pregunta y los datos que la acompañan se envían al proveedor de inteligencia artificial configurado.', '2026-01-01'),

  ('privacy', 'en', '0.1-draft', 'Privacy',
   '## Draft

This text has not been reviewed by a lawyer.

## What we store

What you enter or import: accounts, transactions, documents, and the decisions you make about them. And the minimum needed to run the service: your email, your sessions, and a record of sensitive operations.

## Who sees it

The members of your household, and anyone you explicitly authorize. Isolation between households is enforced by the database, not by application code.

## Documents

Stored in private object storage and read through signed links that expire in five minutes.

## Providers

Database and authentication on Supabase; document storage on Cloudflare R2. If you switch the assistant on, the text of the question and the facts accompanying it are sent to the configured AI provider.', '2026-01-01')
on conflict (kind, locale, version) do nothing;

update platform.schema_version
   set version = 16,
       description = 'Phase 17 — marketing content: pages, FAQs and draft legal documents in both languages',
       applied_at = now()
 where id;
