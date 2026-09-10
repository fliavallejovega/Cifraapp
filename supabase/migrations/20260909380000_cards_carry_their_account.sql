-- Una deuda marcada «tarjeta de crédito» ya tiene cuenta.
--
-- Cuando se escribió la conversión de deuda a cuenta, ninguna deuda del hogar
-- decía ser una tarjeta: las tres se llamaban «Visa» y «Master Card» y estaban
-- registradas con clase `other`. Adivinarlo por el nombre es la clase de
-- inferencia que este sistema no hace sobre datos financieros, así que la
-- conversión se pedía a mano, deuda por deuda, desde la pantalla.
--
-- Eso dejó de aplicar en cuanto el formulario pregunta la clase. Marcar
-- «tarjeta de crédito» **es** la declaración, y pedir después un segundo botón
-- que diga «llevarla como cuenta» es cobrar dos veces por la misma respuesta.
-- Peor: quien marca la clase y no ve nada aparecer en Tarjetas concluye, con
-- razón, que el producto no lo entendió.
--
-- Esta migración pone al día lo ya guardado. **No adivina nada**: sólo toca
-- deudas cuya clase alguien fijó explícitamente en `credit_card` y que todavía
-- no tienen cuenta. Una deuda `other` que se llame «Visa» sigue sin tocarse,
-- porque nadie ha dicho que lo sea.
--
-- ## Qué crea, y con qué procedencia
--
-- Una cuenta `credit_card` con el saldo en negativo —lo que se debe, en la
-- convención de este esquema, para que sumar todas las cuentas dé patrimonio
-- neto y no una cifra que necesite nota al pie— y `source = 'system'`, porque
-- la creó una migración y no una persona. Esa distinción es la que permite
-- contestar «¿de dónde salió esta cuenta?» dentro de seis meses.
--
-- No destruye nada: no borra, no pisa ningún saldo existente, y de las deudas
-- sólo escribe el `account_id` que antes estaba vacío.
--
-- El identificador de la cuenta se genera en el primer paso y se reutiliza en
-- el segundo, en vez de casar después por nombre. Dos tarjetas del mismo banco
-- llamadas igual son un caso corriente en una casa de dos, y casarlas por
-- nombre las cruzaría en silencio.

with objetivo as (
  select
    d.id                        as debt_id,
    public.uuid_generate_v7()   as account_id,
    d.household_id,
    d.name,
    d.current_balance,
    d.credit_limit,
    d.apr,
    d.currency,
    d.person_id
  from app.debts d
  where d.kind = 'credit_card'
    and d.account_id is null
    and d.deleted_at is null
),
creadas as (
  insert into app.accounts (
    id, household_id, name, account_type, current_balance, credit_limit,
    interest_rate, currency, person_id, scope, status, source
  )
  select
    o.account_id,
    o.household_id,
    o.name,
    'credit_card',
    -abs(o.current_balance),
    o.credit_limit,
    o.apr,
    o.currency,
    o.person_id,
    case when o.person_id is null then 'household' else 'personal' end::app.financial_scope,
    'active',
    'system'
  from objetivo o
  returning id
)
update app.debts d
   set account_id = o.account_id,
       updated_at = now()
  from objetivo o
 where d.id = o.debt_id
   -- Fuerza a que el `insert` corra: sin leerlo, Postgres puede podar la CTE.
   and (select count(*) from creadas) >= 0;
