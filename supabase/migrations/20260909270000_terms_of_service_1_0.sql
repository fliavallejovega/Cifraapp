-- El acuerdo que se acepta al abrir una cuenta, y la salvedad del módulo fiscal.
--
-- Lo que había era un borrador de setecientos caracteres. Un producto que
-- calcula impuestos, proyecta flujos y opina sobre deuda necesita decir, con
-- todas sus letras y antes de que alguien registre un solo saldo, tres cosas:
-- que no es una entidad financiera, que no es un contador, y que ninguna cifra
-- suya debe usarse ante una autoridad sin que un profesional con licencia la
-- revise.
--
-- La versión sube a 1.0 en vez de reemplazar el texto de 0.1-draft. El consenti-
-- miento es a un texto concreto en una fecha concreta: pisar el cuerpo de una
-- versión ya aceptada dejaría a quienes la aceptaron habiendo consentido algo
-- que ya no existe, que es exactamente lo que `legal_acceptances` guarda para
-- que no pase.
--
-- `reviewed_at` queda en null a propósito. Nadie con credenciales lo ha leído
-- todavía, y la pantalla legal muestra ese aviso sola mientras siga así. Cuando
-- un abogado lo revise, se estampa `reviewed_by` y `reviewed_at` y el aviso
-- desaparece sin tocar código.


insert into platform.legal_documents (kind, locale, version, title, body, effective_from)
values ('terms', 'es', '1.0', $title$Términos de servicio$title$, $body$## 1. Qué es Cifraapp y qué no es

Cifraapp es una herramienta de **organización y referencia** para las finanzas de un hogar o de un profesional independiente. Ordena información que tú registras o importas, hace cuentas con ella y te la muestra de vuelta.

Eso es todo lo que es. En particular, y sin que la lista sea limitativa, **Cifraapp no es**:

- un banco, una cooperativa, una casa de valores, una fiduciaria ni ninguna otra **entidad financiera**, ni está autorizada, licenciada, registrada ni supervisada como tal por la Superintendencia de Bancos de Panamá, la Superintendencia del Mercado de Valores ni por ningún regulador financiero de ninguna jurisdicción;
- una **firma de contabilidad**, ni un contador público autorizado, ni está habilitada para ejercer la contaduría pública;
- un **asesor financiero, de inversiones o patrimonial**, ni un corredor, ni un administrador de cartera;
- un **asesor fiscal**, ni un preparador de declaraciones de impuestos, ni un agente ante ninguna autoridad tributaria;
- un **estudio jurídico** ni una fuente de asesoría legal.

Nada de lo que veas en Cifraapp constituye asesoría financiera, de inversión, contable, fiscal o legal. Es información para que **tú** decidas y para que **tú** la lleves a un profesional con licencia.

## 2. Cifraapp no sustituye a un contador ni a un asesor con licencia

Este es el punto central de estos términos, y al aceptarlos declaras haberlo leído y entendido:

> **Toda cifra que Cifraapp muestre debe ser revisada y validada por un contador público autorizado, un asesor fiscal o un asesor financiero con licencia antes de que la uses para presentar una declaración, tomar una decisión de inversión, firmar un contrato, solicitar un crédito o cumplir cualquier obligación legal.**

Cifraapp es un punto de partida y una forma de tener tu información ordenada. No es la última palabra sobre nada. Si tu contador y Cifraapp dicen cosas distintas, tu contador tiene la razón.

## 3. De dónde salen las cifras

Para que puedas juzgarlas, esto es exactamente de dónde viene cada número:

**a) De lo que tú escribes.** Saldos, deudas, tasas, compromisos, metas, ingresos y el cuestionario inicial son datos que tú declaras. Cifraapp los toma como ciertos porque no tiene forma de comprobarlos. Si escribes mal una tasa o un saldo, todo lo que se calcule a partir de ahí estará mal, y no será un error del sistema.

**b) De los documentos que importas.** Estados de cuenta en CSV, OFX, XLSX o PDF se interpretan de forma automática. La interpretación puede fallar: un formato inesperado, una columna corrida, un signo invertido, una fecha ambigua. Los movimientos importados son una **lectura** de tu documento, no el documento.

**c) De cálculos deterministas.** Los motores de plan, presupuesto, deuda, proyección e impuestos aplican fórmulas sobre (a) y (b). Son reproducibles y auditables, y son exactamente tan correctos como los datos que reciben.

**d) De estimaciones y supuestos.** Proyecciones, escenarios, simulaciones de deuda y cualquier cifra futura son **estimaciones**. Suponen que las cosas siguen como están. No son promesas ni pronósticos con respaldo.

**e) De modelos de lenguaje.** Algunas explicaciones, clasificaciones y sugerencias las produce un modelo de inteligencia artificial. Un modelo de lenguaje puede equivocarse, puede afirmar con seguridad algo falso y no es la fuente de verdad de ningún saldo, impuesto, permiso o asiento. Su función es explicar y clasificar resultados deterministas, nunca producirlos.

## 4. Materia fiscal

Las reglas fiscales incorporadas en Cifraapp —incluidas las de la República de Panamá— pueden estar **en borrador, incompletas, desactualizadas o ser incorrectas**. Las leyes y sus reglamentos cambian, admiten interpretación y dependen de circunstancias particulares que este sistema no conoce.

Cualquier cifra fiscal que veas es un **estimado de referencia**. No es una declaración, no la sustituye, no la valida y no debe presentarse ante ninguna autoridad tributaria tal como aparece. La responsabilidad de determinar, declarar y pagar correctamente tus impuestos es exclusivamente tuya, y debes hacerlo con un contador público autorizado.

## 5. Tu responsabilidad

Al usar Cifraapp aceptas que:

- eres el único responsable de la exactitud, integridad y legalidad de la información que registras e importas;
- eres el único responsable de las decisiones que tomes, con o sin apoyo de lo que veas aquí;
- verificarás con un profesional con licencia cualquier cifra antes de usarla para un fin legal, fiscal, crediticio o de inversión;
- mantendrás la confidencialidad de tus credenciales y de los códigos de verificación en dos pasos, y responderás por toda actividad realizada desde tu cuenta;
- no usarás Cifraapp para ninguna actividad ilícita, incluidos el lavado de activos, el financiamiento del terrorismo, la evasión fiscal o el fraude;
- si compartes tu hogar con otras personas, entiendes que quienes tengan acceso podrán ver y modificar la información financiera de ese hogar.

## 6. Sin garantías

Cifraapp se entrega **«tal cual» y «según disponibilidad»**, sin garantía de ninguna clase, expresa o implícita. En la medida máxima permitida por la ley aplicable, renunciamos a toda garantía de comerciabilidad, idoneidad para un propósito particular, exactitud, disponibilidad, continuidad, ausencia de errores y no infracción.

No garantizamos que el servicio esté libre de interrupciones, que los cálculos sean exactos, que los documentos se interpreten correctamente, que la información esté actualizada, ni que el servicio cumpla con los requisitos de tu situación particular o de tu jurisdicción.

## 7. Limitación de responsabilidad

En la medida máxima permitida por la ley aplicable, y de forma expresa:

**No somos responsables** por daños directos, indirectos, incidentales, especiales, consecuenciales, punitivos ni ejemplares; ni por lucro cesante, pérdida de ingresos, pérdida de ahorros, pérdida de oportunidad, pérdida de datos, daño reputacional o daño moral; derivados de o relacionados con el uso o la imposibilidad de uso de Cifraapp.

Esto incluye, sin limitación, cualquier perjuicio derivado de:

- una cifra incorrecta, incompleta o mal interpretada;
- un documento importado que se leyó mal;
- una proyección, un escenario o una simulación que no se cumplió;
- una salida producida por un modelo de inteligencia artificial;
- una obligación fiscal mal estimada, presentada fuera de plazo o pagada por un monto equivocado;
- una multa, recargo, interés o sanción impuesta por cualquier autoridad;
- una decisión de inversión, de crédito, de gasto o de ahorro;
- una interrupción, pérdida de datos o falla de un proveedor externo;
- el acceso de un tercero a tu cuenta.

Si alguna jurisdicción no permite excluir determinadas garantías o responsabilidades, dichas exclusiones se aplicarán en la mayor medida que esa jurisdicción permita, y nuestra responsabilidad total y acumulada por cualquier reclamo relacionado con el servicio no excederá **el monto que hayas pagado por Cifraapp durante los doce (12) meses anteriores al hecho que originó el reclamo**, o **cincuenta dólares (US$50,00)**, el que sea menor.

## 8. Indemnidad

Te obligas a mantener indemnes a Cifraapp, a sus titulares, socios, directores, empleados, contratistas y proveedores frente a cualquier reclamo, demanda, pérdida, multa, sanción, costo o gasto —incluidos honorarios razonables de abogado— que surja de tu uso del servicio, de la información que registres, del incumplimiento de estos términos o de la infracción de cualquier ley o derecho de un tercero.

## 9. Proveedores externos

Cifraapp se apoya en servicios de terceros para alojamiento, base de datos, autenticación, correo, pagos, datos de mercado y modelos de lenguaje. No respondemos por sus fallas, interrupciones, cambios, pérdidas de datos ni por sus propias prácticas de privacidad. El uso de esos servicios se rige también por sus términos.

## 10. Tus datos

El tratamiento de tu información personal y financiera se rige por nuestra Política de Privacidad, que forma parte de estos términos. Registrar información financiera en cualquier servicio digital conlleva riesgo; al usar Cifraapp aceptas ese riesgo.

## 11. Disponibilidad, cambios y terminación

Podemos modificar, suspender o descontinuar cualquier parte del servicio en cualquier momento. Podemos modificar estos términos; los cambios sustanciales se te comunicarán y el uso posterior implica aceptación. Podemos suspender o cerrar una cuenta que incumpla estos términos. Puedes dejar de usar el servicio cuando quieras.

## 12. Ley aplicable

Estos términos se rigen por las leyes de la República de Panamá. Cualquier controversia se someterá a los tribunales competentes de la ciudad de Panamá, renunciando las partes a cualquier otro fuero.

## 13. Integridad del acuerdo

Si alguna cláusula se declara inválida o inejecutable, las demás mantendrán plena vigencia. La falta de ejercicio de un derecho no implica su renuncia.

## 14. Tu aceptación

Al marcar la casilla de aceptación y crear una cuenta declaras que:

1. leíste y entendiste estos términos en su totalidad;
2. entiendes que **Cifraapp no es una entidad financiera, ni un contador, ni un asesor con licencia**;
3. entiendes que **Cifraapp es un sistema de referencia y nunca sustituye a un contador público autorizado ni a un asesor financiero con licencia**;
4. entiendes que **toda cifra debe ser revisada por un profesional con licencia** antes de usarse para cualquier fin legal, fiscal, crediticio o de inversión;
5. aceptas usar el servicio bajo estas reglas y bajo tu exclusiva responsabilidad.
$body$, '2026-09-09')
on conflict (kind, locale, version) do update
  set title = excluded.title,
      body  = excluded.body;


insert into platform.legal_documents (kind, locale, version, title, body, effective_from)
values ('terms', 'en', '1.0', $title$Terms of service$title$, $body$## 1. What Cifraapp is, and what it is not

Cifraapp is a tool for **organising and referencing** the finances of a household or an independent professional. It orders information you record or import, does arithmetic with it, and shows it back to you.

That is all it is. In particular, and without limitation, **Cifraapp is not**:

- a bank, credit union, brokerage, trust company or any other **financial institution**, and it is not authorised, licensed, registered or supervised as one by the Superintendency of Banks of Panama, the Superintendency of the Securities Market, or any financial regulator in any jurisdiction;
- an **accounting firm**, a certified public accountant, or qualified to practise public accountancy;
- a **financial, investment or wealth adviser**, a broker, or a portfolio manager;
- a **tax adviser**, a tax return preparer, or an agent before any tax authority;
- a **law firm** or a source of legal advice.

Nothing you see in Cifraapp constitutes financial, investment, accounting, tax or legal advice. It is information for **you** to decide with, and for **you** to take to a licensed professional.

## 2. Cifraapp does not replace an accountant or a licensed adviser

This is the central point of these terms, and by accepting them you confirm you have read and understood it:

> **Every figure Cifraapp shows must be reviewed and validated by a certified public accountant, a tax adviser, or a licensed financial adviser before you use it to file a return, make an investment decision, sign a contract, apply for credit, or meet any legal obligation.**

Cifraapp is a starting point and a way to keep your information in order. It is the last word on nothing. If your accountant and Cifraapp disagree, your accountant is right.

## 3. Where the figures come from

So that you can judge them, this is exactly where every number comes from:

**a) What you type.** Balances, debts, rates, commitments, goals, income and the setup questionnaire are figures you state. Cifraapp takes them as true because it has no way to check them. If you enter a rate or a balance wrongly, everything computed from it will be wrong, and that will not be a fault of the system.

**b) Documents you import.** Statements in CSV, OFX, XLSX or PDF are parsed automatically. Parsing can fail: an unexpected format, a shifted column, an inverted sign, an ambiguous date. Imported movements are a **reading** of your document, not the document.

**c) Deterministic calculation.** The plan, budget, debt, projection and tax engines apply formulas over (a) and (b). They are reproducible and auditable, and exactly as correct as the data they are given.

**d) Estimates and assumptions.** Projections, scenarios, debt simulations and any forward-looking figure are **estimates**. They assume things continue as they are. They are not promises or supported forecasts.

**e) Language models.** Some explanations, classifications and suggestions are produced by an artificial-intelligence model. A language model can be wrong, can state something false with confidence, and is never the source of truth for a balance, a tax figure, a permission or a ledger entry. Its role is to explain and classify deterministic output, never to produce it.

## 4. Tax matters

The tax rules built into Cifraapp — including those of the Republic of Panama — may be **draft, incomplete, out of date or incorrect**. Laws and their regulations change, admit interpretation, and depend on particular circumstances this system does not know.

Any tax figure you see is a **reference estimate**. It is not a return, does not replace one, does not validate one, and must not be filed with any tax authority as it appears. Determining, declaring and paying your taxes correctly is solely your responsibility, and you must do it with a certified public accountant.

## 5. Your responsibility

By using Cifraapp you accept that:

- you are solely responsible for the accuracy, completeness and legality of the information you record and import;
- you are solely responsible for the decisions you make, with or without what you see here;
- you will verify any figure with a licensed professional before using it for a legal, tax, credit or investment purpose;
- you will keep your credentials and two-step codes confidential, and you answer for all activity from your account;
- you will not use Cifraapp for unlawful activity, including money laundering, terrorist financing, tax evasion or fraud;
- if you share a household with other people, you understand that those with access can see and change that household's financial information.

## 6. No warranties

Cifraapp is provided **"as is" and "as available"**, without warranty of any kind, express or implied. To the maximum extent permitted by applicable law, we disclaim all warranties of merchantability, fitness for a particular purpose, accuracy, availability, continuity, freedom from error, and non-infringement.

We do not warrant that the service will be uninterrupted, that calculations will be accurate, that documents will be parsed correctly, that information will be current, or that the service meets the requirements of your particular situation or jurisdiction.

## 7. Limitation of liability

To the maximum extent permitted by applicable law, and expressly:

**We are not liable** for direct, indirect, incidental, special, consequential, punitive or exemplary damages; nor for lost profit, lost revenue, lost savings, lost opportunity, lost data, reputational harm or moral damage; arising from or related to the use of, or inability to use, Cifraapp.

This includes, without limitation, any harm arising from:

- an incorrect, incomplete or misread figure;
- an imported document that was parsed wrongly;
- a projection, scenario or simulation that did not come to pass;
- output produced by an artificial-intelligence model;
- a tax obligation mis-estimated, filed late, or paid in the wrong amount;
- a fine, surcharge, interest or penalty imposed by any authority;
- an investment, credit, spending or saving decision;
- an interruption, data loss, or failure of an external provider;
- a third party gaining access to your account.

Where a jurisdiction does not allow certain warranties or liabilities to be excluded, those exclusions apply to the greatest extent that jurisdiction permits, and our total aggregate liability for any claim relating to the service will not exceed **the amount you paid for Cifraapp in the twelve (12) months preceding the event giving rise to the claim**, or **fifty United States dollars (US$50.00)**, whichever is lower.

## 8. Indemnity

You agree to hold Cifraapp, its owners, partners, directors, employees, contractors and suppliers harmless from any claim, demand, loss, fine, penalty, cost or expense — including reasonable legal fees — arising from your use of the service, the information you record, your breach of these terms, or your infringement of any law or third-party right.

## 9. External providers

Cifraapp relies on third-party services for hosting, database, authentication, mail, payments, market data and language models. We are not answerable for their failures, interruptions, changes, data loss, or their own privacy practices. Use of those services is also governed by their terms.

## 10. Your data

The handling of your personal and financial information is governed by our Privacy Policy, which forms part of these terms. Recording financial information in any digital service carries risk; by using Cifraapp you accept that risk.

## 11. Availability, changes and termination

We may modify, suspend or discontinue any part of the service at any time. We may amend these terms; material changes will be communicated to you and continued use constitutes acceptance. We may suspend or close an account that breaches these terms. You may stop using the service at any time.

## 12. Governing law

These terms are governed by the laws of the Republic of Panama. Any dispute will be submitted to the competent courts of Panama City, the parties waiving any other venue.

## 13. Entire agreement

If any clause is held invalid or unenforceable, the rest remain in full force. Failure to exercise a right is not a waiver of it.

## 14. Your acceptance

By ticking the acceptance box and creating an account you declare that:

1. you have read and understood these terms in full;
2. you understand that **Cifraapp is not a financial institution, an accountant, or a licensed adviser**;
3. you understand that **Cifraapp is a reference system and never replaces a certified public accountant or a licensed financial adviser**;
4. you understand that **every figure must be reviewed by a licensed professional** before being used for any legal, tax, credit or investment purpose;
5. you accept using the service under these rules and at your sole responsibility.
$body$, '2026-09-09')
on conflict (kind, locale, version) do update
  set title = excluded.title,
      body  = excluded.body;


insert into platform.legal_documents (kind, locale, version, title, body, effective_from)
values ('tax_disclaimer', 'es', '1.0', $title$Salvedad fiscal$title$, $body$Las cifras fiscales de Cifraapp son **estimados de referencia**, no una declaración.

Cifraapp no es una firma de contabilidad ni un asesor fiscal, y no está autorizada para ejercer la contaduría pública. Las reglas incorporadas pueden estar en borrador, incompletas o desactualizadas, y no conocen las particularidades de tu caso.

**Antes de declarar o pagar, lleva estos números a un contador público autorizado.** La responsabilidad de determinar, presentar y pagar correctamente tus impuestos es exclusivamente tuya.

Esto es un resumen. Las reglas completas están en los [Términos de servicio](/terms).
$body$, '2026-09-09')
on conflict (kind, locale, version) do update
  set title = excluded.title,
      body  = excluded.body;


insert into platform.legal_documents (kind, locale, version, title, body, effective_from)
values ('tax_disclaimer', 'en', '1.0', $title$Tax disclaimer$title$, $body$Cifraapp's tax figures are **reference estimates**, not a return.

Cifraapp is not an accounting firm or a tax adviser, and is not qualified to practise public accountancy. The rules built in may be draft, incomplete or out of date, and they do not know the particulars of your case.

**Before you file or pay, take these numbers to a certified public accountant.** Determining, filing and paying your taxes correctly is solely your responsibility.

This is a summary. The full rules are in the [Terms of service](/terms).
$body$, '2026-09-09')
on conflict (kind, locale, version) do update
  set title = excluded.title,
      body  = excluded.body;
