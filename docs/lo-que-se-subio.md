# Todo lo que se subió

Del 9 al 10 de septiembre de 2026. Ocho despliegues a producción, dieciséis
migraciones aplicadas y verificadas contra la base real.

Este documento es el registro completo: qué se construyó, qué decisión hay
detrás de cada pieza, **qué quedó fuera y por qué**, y qué necesita de vos para
funcionar.

---

## 1 · Ingreso variable: el piso y el colchón

**El problema.** Un hogar que vive de vender no tiene sueldo. Con meses de
$6,000, $1,000, $4,000, $0, $8,000 y $2,000, el promedio da $3,500 — y
comprometerse a $3,500 garantiza la insolvencia el mes de $0, que va a llegar
porque ya llegó.

**Lo que se construyó.** `computeIncomeFloor` saca el percentil 25 de los meses
de cobros reales. Sobre esos mismos seis meses da **$1,000**, no $3,500.

Tres decisiones que importan:

- **Un mes en cero cuenta como un cero.** Agrupar sólo los meses con cobros
  borraría exactamente los meses que el piso existe para sobrevivir.
- **El piso declarado y el medido conviven.** `measured`, `declared` y `unknown`
  son tres estados distintos. «No hay piso» no es «el piso es cero».
- **El objetivo del colchón sale de tu volatilidad**, no de la regla genérica de
  tres meses: tres si el ingreso varía menos del 15% alrededor de su mediana,
  seis si alterna gordos con secos.

El faltante del colchón entra al plan como reclamo `emergency_fund` — la
escalera de asignación ya lo colocaba delante de las metas, así que no hubo que
tocar el motor.

**Archivos:** `packages/budget-engine/src/income-floor.ts`, `cushion.ts` · 25
pruebas · `apps/web/src/components/income-floor-panel.tsx`

---

## 2 · Cobertura: qué compromiso tiene dinero detrás

Cada compromiso queda **cubierto**, **condicional** o **descubierto**, con una
regla que hace todo el trabajo: un cobro sólo cubre un compromiso si **su
ventana cierra antes del vencimiento**. Una factura que llega «entre el 20 y el
30» no paga un alquiler del 25 — puede que sí y puede que no, y un plan que
asume que sí te deja explicando por qué el 25 no había plata.

El reparto es codicioso y ordenado por certeza: el alquiler del 10 se apoya
primero en lo facturado que llega antes del 10, y lo flojo financia lo del 28.

De ahí sale la frase del plan: *«Tus compromisos de los próximos 30 días suman
$1,836. Con lo que tenés cubrís hasta el 14. Para llegar al final tienen que
entrar $1,240 antes del 26. Esperás $3,400, de los cuales $1,900 son
confirmados.»*

**Archivos:** `packages/budget-engine/src/coverage.ts` · 10 pruebas ·
`repositories/plan.ts`

---

## 3 · Reserva fiscal en el momento del cobro

A un asalariado le retienen; a un independiente no le retiene nadie. El único
momento en que apartar el impuesto es indoloro es cuando la plata entra, así que
va pegado al acto de dar por cobrado.

El monto y la tasa se **congelan** ahí: subir la tasa en junio no cambia lo que
marzo reservó. La suma de lo apartado y no pagado reemplaza al «porcentaje del
saldo líquido» que el plan deducía antes — que subía cuando cobrabas algo no
gravado y bajaba sola cuando pagabas el alquiler.

**El porcentaje lo fijás vos en Ajustes.** No sale de las reglas de Panamá
cargadas en la plataforma: son un borrador sin revisar, y el esquema se niega a
publicar un conjunto de reglas sin firma.

**Archivos:** `receivable-actions.ts/reserveOnReceipt` · migración
`20260909310000`

---

## 4 · El correo del banco, leído solo

Los avisos de transacción llegan en el segundo en que pasás la tarjeta, son
texto plano y no traen adjunto. Se leen desde Gmail con OAuth y se parsean sin
plantilla por banco — se buscan las cinco señales (monto, dirección, comercio,
fecha, últimos cuatro) en cualquier redacción.

**Entran como propuesta, nunca como movimiento.** El aviso y la línea del PDF
del mes siguiente son la misma compra; meterla dos veces te sube el gasto sin
que hayas gastado. La fila lleva la misma huella que producirá el PDF para que
el motor de duplicados las reconozca como una.

La consulta se limita a remitentes de bancos panameños y a los últimos diez
días. El permiso de Google da el buzón entero; que lo dé no significa que este
producto deba leerlo, y ese recorte está en el código.

**El cuerpo del correo no se guarda.** Se lee, se saca el movimiento, y lo que
persiste es el identificador y el veredicto.

**Archivos:** `packages/transaction-engine/src/parsers/bank-alert.ts` · 24
pruebas · `server/google/sweep.ts`

---

## 5 · Calendario de compromisos

Dos caminos, porque no son lo mismo:

- **Enlace suscribible** (`.ics` por URL secreta) — no pide la cuenta de nadie,
  se pega en Apple Calendar o Google Calendar, funciona en cualquier teléfono.
  Eventos de día completo con aviso el día antes.
- **Cuenta de Google conectada** — eventos de verdad en un calendario propio,
  que se pueden tocar y marcar hechos. Nunca en tu calendario principal: apagar
  la función es borrar un calendario, no sacar eventos de entre tus cumpleaños.

Apple y Google no saben iniciar sesión: leen una URL desde sus servidores. El
secreto viaja en la dirección, y por eso **se guarda hasheado, se puede revocar,
y detrás no hay nada más que los compromisos**.

**Archivos:** `packages/budget-engine/src/calendar.ts` · 17 pruebas ·
`api/calendar/[token]`

---

## 6 · El chat que propone cambios

El modelo convierte una frase en filas de un **catálogo cerrado**, y cada una
pasa tres puertas deterministas:

1. **El tipo** tiene que estar en la lista.
2. **El objetivo** tiene que ser una fila de tu hogar.
3. **Las cifras** tienen que estar entre los datos que se le dieron — no puede
   proponer $1,500 sumando $1,000 y $500, que es el cálculo que un modelo hace
   bien casi siempre y mal a veces.

Y después de las tres, sigue sin aplicarse: espera tu confirmación. La fila
guarda quién propuso, quién aprobó y **qué valor había antes**.

**Archivos:** `packages/ai/src/proposal.ts` · 19 pruebas · tabla
`plan_proposals`

---

## 7 · Tarjetas: la pantalla completa

Una tarjeta era dos filas en dos pantallas: la deuda en Deudas, la cuenta en
Cuentas. Nadie piensa en su tarjeta como dos cosas.

**Ahora todo vive en `/cards`**, con un panel por tarjeta y tres pestañas:

| Pestaña | Qué hace |
| --- | --- |
| **Datos** | Nombre, red, nivel, emisor, cupo, anualidad, últimos 4, saldo, tasa, mínimo, día de corte, día de pago, dueño. Crear y archivar. |
| **Beneficios** | Los tuyos, anotados de tu contrato, con fuente y vencimiento. Más el catálogo del mercado. |
| **Estado de cuenta** | Subir el archivo con la tarjeta ya fijada. |

**Cupo con banda de color y su palabra:** holgada (<30%), apretada (30–70%), al
límite (>70%). Los cortes son los que usa la industria del crédito. Cada banda
lleva la palabra además del color — quien no distingue ámbar de rojo tiene que
poder leer lo mismo.

**Marcar «tarjeta de crédito» ya vincula la cuenta.** Pedirte un segundo botón
después de haber declarado que es una tarjeta era cobrarte dos veces por la
misma respuesta. Una migración puso al día tus tres tarjetas ya guardadas.

**Los campos del formulario de deudas ahora dependen del tipo.** A una hipoteca
ya no se le pide el cupo de una tarjeta. Y lo que no se enseña tampoco se envía:
cambiar una tarjeta a hipoteca **borra** su cupo.

**Archivos:** `components/cards-manager.tsx`, `server/card-actions.ts`,
`repositories/cards.ts`

---

## 8 · El catálogo de tarjetas de Panamá

**Aquí me equivoqué primero y lo corrijo.** Dije que no publicaría un catálogo
porque los beneficios cambian y una tabla vieja miente. Lo primero es cierto; la
conclusión no. No publicar nada te deja buscando en ocho sitios web cuál de tus
tres tarjetas conviene en el supermercado — que es justo el trabajo que un
producto de finanzas debe quitar.

La respuesta correcta es **publicar con procedencia**.

### Qué hay

**43 líneas de ocho emisores**, cada una con su dirección, su fecha de lectura y
cuándo conviene reconfirmarla:

| Banco | Qué se leyó |
| --- | --- |
| Banco General | Programa Estrellas, Visa ConnectMiles, Visa CashBack, cobertura de fraude por nivel |
| BAC Credomatic | Cashback 5% supermercados y gasolineras, 1% comida rápida y farmacias, ConnectMiles, LifeMiles Infinite |
| Banistmo | Programa Regálate, adicional sin membresía, cobertura de fraude, cashback personalizable |
| Global Bank | Link Points, anualidad por segmento |
| Banesco | Visa Platinum e Infinite ConnectMiles, anualidad del primer año |
| Scotiabank/Davivienda | Visa Signature +Premios: 3x en viajes, 2x en restaurantes, puntos que no vencen |
| Credicorp Bank | Visa Clásica y Platinum Rewards, canje de puntos |
| Mercantil Banco | Mastercard Platinum: puntos canjeables por efectivo, asistencia de viaje |

Más **Visa por nivel** (seguro de alquiler de vehículo, equipaje, salas VIP por
LoungeKey, concierge) que aplica lo emita quien lo emita.

### La fuente que lo hace sostenible

**ACODECO** — la Autoridad de Protección al Consumidor publica un estudio
comparativo periódico de tasas y anualidades de todas las tarjetas emitidas en
Panamá. Es la única fuente a la vez **oficial, transversal y republicada con
calendario**. De ahí salen las referencias de mercado: anualidad y tasa más
bajas por segmento. Un banco publica lo suyo cuando quiere; ACODECO publica lo
de todos cuando toca.

### Los doce bancos que faltan

Multibank · Banco Nacional · Caja de Ahorros · Towerbank · Capital Bank · Banco
Aliado · Prival · St. Georges · Unibank · Lafise · Metrobank · Canal Bank

Están **declarados pendientes por nombre** en `docs/catalogo-tarjetas.md`. Hay un
gate que falla si un banco no está ni cubierto ni declarado: una omisión
silenciosa en un catálogo «de todos los bancos» es peor que una lista corta.

---

## 9 · Ofertas del mes

Tabla propia, porque **una promoción no es un beneficio**: un beneficio dura lo
que dure la tarjeta, una promoción tiene comercio, días, tope y se acaba.
Guardarlas juntas obligaría a que una mintiera sobre la otra.

Incluye **débito** —la mitad de las de Panamá lo son— y **bancos donde no tenés
cuenta**, porque saber que el de al lado da 50% donde el tuyo no da nada es cómo
alguien decide abrir una.

Ejemplo real cargado: *Fosters, 50% del total, los martes de septiembre, tope
$125 sobre consumo de $250, sólo en el local, con tarjetas personales Visa o
Mastercard de Banco General.*

La pantalla contesta **con cuál de tus tarjetas pagás ahí**. Filtros: sólo las
mías, por banco, por categoría. El resto no se esconde, se ordena detrás.

---

## 10 · El barrido mensual

El **día 1 de cada mes**, dentro del cron diario:

1. **Relee las 32 fuentes** y compara una huella del **texto legible** — no del
   HTML, porque un banco que cambia una clase de CSS no cambió sus condiciones,
   y marcarlo llenaría la lista de revisiones falsas hasta que nadie la mire.
2. **Marca lo que se movió.** Las filas de esa página quedan señaladas. **El dato
   no se toca**: reinterpretar una página automáticamente y pisar lo que había es
   como se mete una cifra inventada en un producto financiero.
3. **Las promociones sí se extraen solas**, porque esperar a que alguien las
   confirme garantiza enseñarlas vencidas. Entran como `unverified` y la pantalla
   lo dice. Un modelo lee la página; el catálogo cerrado que decide qué entra
   corre después y sin él.
4. **Lo vencido se marca vencido**, según la fecha que la propia promoción dio.

A mano: `GET /api/cron/catalogue` con el secreto del cron.

**Dos niveles de confianza, siempre visibles:** `verified` lo comprobó una
persona; `unverified` lo leyó el barrido. Una promoción leída por una máquina es
una pista muy buena y no es un hecho.

---

## 11 · Los correos: un lenguaje y un módulo para editarlos

Todo correo que sale de Cifraapp —los avisos por Brevo y los de cuenta por
Supabase— comparte un diseño: el marfil y la tinta del producto convertidos a
hex, Archivo para el texto, Chivo Mono para los montos en cifras tabulares, el
latón sólo en la marca y el botón en tinta. Español primero, inglés al lado,
modo oscuro, versión en texto y menos de 102 KB para que Gmail no lo recorte.

- **Paquete `@app/email`:** catálogo de 15 correos (2 avisos, 13 de cuenta),
  renderizador, validación y envío por Brevo. 48 pruebas, incluida la que
  inyecta HTML en cada campo y en cada variable.
- **Consola → Emails:** lista de los 15 con su estado por idioma y su estado
  real en Supabase (leído en vivo). Cada uno se edita en seis campos —asunto,
  vista previa, título, cuerpo, botón, nota— al lado de la vista previa real,
  en claro/oscuro y escritorio/teléfono, con variables insertables, prueba a tu
  propio correo, historial con restaurar, y vuelta al texto de fábrica.
- **Reglas:** sólo `content_admin` o `super_admin` escribe; todo queda en
  `audit.admin_actions` con el antes y el después. Un correo de cuenta no se
  guarda sin su botón (sería dejar a alguien sin poder entrar), y `{{ }}` no se
  puede escribir: sólo la consola pone expresiones de Supabase.
- **Los avisos ya salen con el diseño** y en el idioma del perfil de cada
  persona, con lo editado en la consola ganando sobre lo de fábrica.
- **Pendiente:** Supabase (plan gratuito) no deja cambiar sus plantillas sin un
  SMTP propio. Hace falta una clave SMTP de Brevo (`xsmtpsib-…`); con ella,
  `node scripts/connect-supabase-smtp.mjs` y `node scripts/publish-auth-emails.mjs`.
  Eso también quita el límite de 2 correos de cuenta por hora.

---

## Lo que el producto se niega a hacer

Vale la pena que lo sepas explícitamente:

- **No corona a nadie sin una cifra que lo sostenga.** Una tarjeta sin beneficio
  comparable no cae al final como si diera cero: va a un grupo aparte que dice
  «no se sabe». Cuánto vale una milla depende de a dónde vueles.
- **No opina sobre tus inversiones.** Las decisiones por posición (no la toco /
  quiero salir / la quiero mover) las tomás vos, sin opción preseleccionada. El
  producto dice la consecuencia sobre tu plan, que es aritmética.
- **No calcula impuestos con reglas sin revisar.** El borrador de Panamá está
  cargado y el esquema se niega a publicarlo sin firma.
- **No marcó el TOS como revisado.** El mecanismo existe y exige el nombre de
  quien revisó. Escribir que un abogado revisó lo que ningún abogado revisó es un
  registro falso sobre un documento legal.
- **No inventa OCR.** El importador lee CSV, OFX, XLSX y PDF **con capa de
  texto**. Un PDF escaneado se rechaza por su nombre: este despliegue no tiene
  proveedor de OCR.

---

## Dos veces que me equivoqué

**El sitio se cayó.** Pasé `search: (key) => t(key)` de una página de servidor a
un componente de cliente. React no puede serializar una función cruzando esa
frontera y `/es/accounts` reventó entero. Lo grave es que **el gate pasó en
verde**: lint, typecheck, 700 pruebas y build no ven ese error, y la página es
dinámica así que el build tampoco la renderiza. El arreglo devuelve la
comprobación al compilador tipando la prop como datos.

**Dos gates mentían.** El de cobertura daba los veinte bancos por cubiertos
porque buscaba el nombre en todo el archivo. El de procedencia contaba siete de
cuarenta y nueve filas porque una expresión regular no emparejaba tuplas de
cinco líneas — y un texto sembrado lleva un punto y coma dentro de una cadena
que le partía la sentencia. Los dos se arreglaron y se verificaron contra un
control negativo antes de confiar en ellos.

---

## Lo que necesita de vos

| Qué | Por qué |
| --- | --- |
| **Poner los cupos** de tus tarjetas | Sin cupo no hay porcentaje que calcular, y no aparece la barra ni la banda |
| **Poner los últimos 4 dígitos** | Con dos Visas en la casa, es lo que hace que un estado de cuenta caiga en la correcta |
| **Fijar tu porcentaje de reserva** en Ajustes | Sin tasa declarada, la Fase D no aparta nada |
| **Marcar cobros como recibidos** | El piso se mide sobre eso y sobre nada más |
| **Las tres claves de Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` (32 bytes en base64) |
| **La firma del abogado** sobre el TOS | `node scripts/mark-legal-reviewed.mjs --kind terms --version 1.0 --by "..."` |

Sobre Gmail: `gmail.readonly` es un *restricted scope*. Google exige
verificación de la aplicación **más** evaluación de seguridad anual por un
tercero antes de usarlo con usuarios que no sean de prueba. Semanas o meses, y
cuesta. El calendario (`sensitive`) es mucho más barato de llegar a producción,
y el enlace suscribible no necesita nada.

---

## Estado técnico

- **16 migraciones** aplicadas y verificadas contra `information_schema` y
  `pg_class`, no dadas por hecho
- **43 beneficios · 6 promociones · 32 fuentes vigiladas · 0 filas huérfanas**
- **20 emisores** con llave estable
- **10/10 gates** con evidencia registrada
- lint, typecheck, ~700 pruebas y build en verde
- El hogar duplicado «Familia Vallejo Vega» se borró, con respaldo en
  `~/Desktop/cifraapp-hogar-duplicado-respaldo.json`

**Lo que el gate no cubre:** el renderizado de las pantallas. Sólo lo atrapa
cargarlas con sesión. Cuando me digas que están en producción, el smoke test e2e
pasa a ser obligatorio en cada update — ya está anotado.
