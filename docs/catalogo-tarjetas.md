# El catálogo de tarjetas de Panamá

Qué hay dentro, de dónde salió cada línea, y qué falta.

## Qué es y qué no es

Es una lectura fechada de lo que los emisores publican. **No es asesoría, no es
exhaustivo y no reemplaza al contrato.** Cada fila lleva la dirección de donde
se leyó y el día en que se leyó, y la pantalla enseña las dos cosas al lado del
dato: una condición de tarjeta leída hace ocho meses es una pista, no un hecho.

Cifraapp no tiene acuerdo con ningún banco y no cobra por aparecer.

## Bancos cubiertos

Con al menos una fuente registrada y filas en el catálogo:

| Banco | Llave | Qué se leyó |
| --- | --- | --- |
| Banco General | `banco_general` | Programa Estrellas, Visa ConnectMiles, Visa CashBack, cobertura de fraude por nivel, promociones de restaurantes |
| BAC Credomatic | `bac` | Cashback por categoría, ConnectMiles, LifeMiles Infinite, promociones de débito |
| Banistmo | `banistmo` | Programa Regálate, adicional sin membresía, cobertura de fraude, cashback personalizable |
| Global Bank | `global_bank` | Link Points, anualidad por segmento |
| Banesco | `banesco` | Visa Platinum e Infinite ConnectMiles, anualidad del primer año |
| Scotiabank (Davivienda) | `scotiabank` | Visa Signature +Premios: acumulación, vigencia de puntos, membresía |
| Credicorp Bank | `credicorp` | Visa Clásica y Platinum Rewards, canje de puntos |
| Mercantil Banco | `mercantil` | Mastercard Platinum: puntos y asistencia de viaje |

Y dos fuentes que no son de un banco:

- **ACODECO** — la Autoridad de Protección al Consumidor y Defensa de la
  Competencia publica un estudio comparativo periódico de tasas y anualidades de
  las tarjetas emitidas en Panamá. Es la única fuente del catálogo que es a la
  vez oficial, transversal a todos los bancos y republicada con calendario. De
  ahí salen las referencias de mercado: la anualidad y la tasa más bajas por
  segmento.
- **Visa Panamá** — beneficios de red por nivel (Infinite, Signature): seguro de
  alquiler de vehículo, seguro de equipaje, salas VIP por LoungeKey y concierge.
  Aplican lo emita quien lo emita, y por eso van con emisor nulo.

## Bancos pendientes

Están sembrados como instituciones y el hogar puede elegirlos, pero **nadie ha
leído sus condiciones todavía**. La pantalla no inventa nada para ellos:

Multibank · Banco Nacional de Panamá · Caja de Ahorros · Towerbank ·
Capital Bank · Banco Aliado · Prival Bank · St. Georges Bank · Unibank ·
Banco Lafise · Metrobank · Canal Bank

Cubrir uno es añadir su página a `platform.catalogue_sources` y sus filas al
catálogo con la fecha de lectura. El barrido mensual se encarga del resto.

## Cómo se mantiene al día

El primer día de cada mes, dentro del cron diario:

1. **Se relee cada fuente** y se compara una huella del texto contra la
   guardada. La huella se saca del texto legible y no del HTML, porque un banco
   que cambia una clase de CSS no cambió sus condiciones.
2. **Lo que se movió queda marcado.** Las filas que salieron de esa página se
   señalan como «la fuente cambió desde esta lectura». **El dato no se toca**:
   reinterpretar una página automáticamente y pisar lo que había es como se mete
   una cifra inventada en un producto financiero.
3. **Las promociones sí se extraen solas.** Son las que cambian cada mes por
   diseño, y esperar a que alguien las confirme garantiza enseñarlas vencidas.
   Entran como `unverified`, con su fuente y su fecha, y la pantalla las marca.
4. **Lo vencido se marca vencido**, según la fecha que la propia promoción dio.

A mano: `GET /api/cron/catalogue` con el secreto del cron. Sirve cuando sale un
estudio nuevo de ACODECO o un banco cambia sus promociones a mitad de mes.

## Los dos niveles de confianza

- **`verified`** — lo confirmó una persona contra la página oficial.
- **`unverified`** — lo leyó el barrido. Es una pista muy buena y no es un hecho,
  y la pantalla lo dice con esas palabras.

Un beneficio que el hogar anota de su propio contrato es lo más confiable que
hay en el sistema, y por eso el comparativo lo trata como confirmado.

## Lo que el comparativo se niega a hacer

Ordena por la cifra que la fuente declaró. Una tarjeta sin cifra comparable
—millas, puntos, salas VIP— **no cae al final como si diera cero**: va a un grupo
aparte que dice «no se sabe». Cuánto vale una milla depende de a dónde vuele la
persona, y este producto no lo va a adivinar.

Tampoco corona a nadie cuando ninguna cifra lo sostiene: premiar a la única
tarjeta que alguien cargó sería premiar el haberla cargado.
