# Plan de negocio y análisis de brechas

Escrito el 7 de septiembre de 2026, después de recorrer el producto en
producción con una cuenta real. Este documento reemplaza cualquier lectura
optimista del avance: dice qué es el producto, qué existe de verdad, qué falta,
en qué orden construirlo y cuánto cuesta.

`docs/roadmap.md` sigue siendo el registro por fases. Este documento es la vista
de negocio y la lista completa de lo que falta.

---

## 0. Estado de ejecución

**Este análisis está ejecutado. Las 37 pantallas que faltaban están
construidas: 43 de 43.** El resto del documento se conserva tal como se
escribió, porque es el registro de lo que se encontró y de por qué se decidió
este orden — no se reescribe para que parezca que siempre estuvo bien.

| Capa                   | Al escribirlo             | Hoy                                                      |
| ---------------------- | ------------------------- | -------------------------------------------------------- |
| Base de datos          | 75 tablas, 22 migraciones | 82 tablas, 26 migraciones                                |
| Motores de cálculo     | 439 pruebas               | 460 pruebas, todas con superficie de producto            |
| Superficie de producto | 6 de 43                   | **43 de 43**                                             |
| Inteligencia (IA)      | apagada                   | consejo, alertas y chat construidos; **sigue sin clave** |
| Monetización           | sin Stripe                | pantalla de suscripción construida; **sigue sin Stripe** |

Las cinco fases se entregaron en el orden que este documento propuso:

1. **Que el hogar se pueda administrar** — 12 pantallas. Movimientos con
   búsqueda y corrección, ingresos, deudas, metas, compromisos, rubros,
   personas y ajustes. Migración 23.
2. **Que los datos entren solos** — 7 pantallas. Trabajos en segundo plano,
   lectores de PDF y XLSX escritos sin dependencias, y cuatro colas de revisión
   donde el motor propone y nunca decide. Migración 24.
3. **Que el sistema aconseje** — 8 pantallas. Presupuestos, consejo, alertas,
   simulador, seguimiento del plan, constructor de reglas y chat. Migración 25.
4. **Que se pueda cobrar y compartir** — 7 pantallas. Suscripción, miembros,
   contadores, selector de hogar, avisos, perfil fiscal y reserva. Migración 26.
5. **Profundidad** — 4 pantallas. Escenarios, proyección, cierre de mes y
   exportaciones en CSV, JSON, XLSX y PDF.

**Lo que sigue sin ser cierto**, dicho en la pantalla que lo necesita y no
escondido: el OCR necesita un proveedor, el cobro necesita una cuenta de
Stripe, el copiloto necesita una clave, y las reglas fiscales de Panamá
necesitan la revisión de un contador panameño antes de que una sola cifra
derivada de ellas se le muestre a nadie. Los riesgos de la sección 8 —
empezando por rotar las credenciales que se pegaron en un chat — siguen
abiertos y no dependen de ninguna fase.

---

## 1. Qué es el producto

**Cifrapp es el sistema operativo financiero de un hogar.** No es una app de
presupuesto ni un categorizador de gastos: es el sistema que responde tres
preguntas que ningún banco responde, en este orden.

1. **¿Cuánto tengo de verdad?** No el saldo — el saldo miente. Lo que queda
   después de que el alquiler, la tarjeta, el colegio y el colchón ya tomaron
   lo suyo.
2. **¿Qué ya tiene dueño?** Cada compromiso, con su fecha y su monto, itemizado
   y verificable.
3. **¿Qué debe hacer el próximo dólar?** Un plan concreto, línea por línea, con
   el porqué de cada una — no un consejo genérico.

**Para quién.** Hogares panameños de clase media y profesionales
independientes: dos ingresos, una o dos tarjetas, un préstamo, hijos, y ninguna
herramienta que junte todo eso en una sola cifra confiable. El segundo mercado
son los contadores que atienden a varios de esos hogares.

**Por qué en Panamá.** Dólar y balboa a la par, banca fragmentada sin agregador
confiable, y un régimen fiscal donde un independiente necesita saber cuánto
apartar para impuestos y nadie se lo dice. Es un mercado que el software
financiero global ignora porque es chico, y que las apps locales no atacan
porque son de bancos individuales.

**La diferencia defendible.** El producto nunca deja que la IA sea la fuente de
la verdad de un número. Los motores son deterministas y auditables; la IA
clasifica y explica lo que el motor ya calculó. Eso es lo que permite decirle a
alguien "asigná $2,590 a esta tarjeta porque carga 24.5%" y que la frase sea
verificable.

---

## 2. Dónde estamos de verdad

Tu lectura —"el sistema se siente a un 15% de lo que debe ser"— es correcta en
la superficie que se toca, y hay que decirla con números.

| Capa                   | Estado         | Medida                                               |
| ---------------------- | -------------- | ---------------------------------------------------- |
| Base de datos          | **~95%**       | 75 tablas, 22 migraciones, RLS forzado en todas      |
| Motores de cálculo     | **~85%**       | 16 paquetes, 439 pruebas verdes                      |
| Superficie de producto | **~15%**       | **6 pantallas** de las ~40 que el modelo exige       |
| Inteligencia (IA)      | **0% visible** | Motor listo y probado; `AI_PROVIDER=none`, sin clave |
| Monetización           | **0%**         | Catálogo y límites en base; sin Stripe conectado     |

**La forma exacta del problema:** se construyó una fábrica completa y se abrió
una sola ventanilla. Hay motores para deuda, presupuesto, reglas, escenarios,
impuestos, categorización y asignación — todos probados — leyendo tablas que la
interfaz no puede crear ni mostrar.

**Alrededor de 45 de las 75 tablas no tienen ninguna pantalla donde
administrarlas.** Entre ellas:
`transactions` (los movimientos), `goals`, `debts`, `obligations`,
`recurring_series` (los ingresos), `categories` (los rubros de gasto),
`budgets`, `rules`, `household_members`, `tax_profiles`, `scenarios`, y toda la
familia `ai_*`.

### El caso más grave

**No existe una pantalla de movimientos.** Se puede importar un estado de
cuenta, revisarlo y confirmarlo — y después los movimientos desaparecen dentro
del sistema. No hay dónde verlos, buscarlos, corregirles la categoría ni
excluir uno. Es el equivalente a un banco sin estado de cuenta. Esto es lo
primero que hay que construir.

---

## 3. Todo lo que falta

Esta sección recoge, literalmente, todo lo que señalaste, más lo que encontré
auditando el modelo. Nada de esto es opcional para que el producto cumpla su
promesa.

### A. La configuración del hogar — _lo que dijiste que no existe_

| #   | Falta                                                                                | Estado hoy                                                                               |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A1  | **Quiénes viven en la casa** — miembros, quién depende de quién, quién ve qué        | El cuestionario guarda solo un conteo; `household_members` sin pantalla                  |
| A2  | **Cuánto ganamos** — salarios y otros ingresos, recurrentes o aproximados            | El cuestionario los crea una vez; **no se pueden ver, editar ni borrar**                 |
| A3  | **Mis deudas** — tarjetas, préstamos, hipoteca, con tasa y mínimo                    | Igual: se crean en el cuestionario y quedan invisibles                                   |
| A4  | **Mis metas y objetivos** — con monto, fecha y prioridad                             | Igual, y sin ver el avance de ninguna                                                    |
| A5  | **Compromisos mensuales** — alquiler, luz, colegio                                   | Igual                                                                                    |
| A6  | **Rubros de gasto** — las categorías con las que se clasifica todo                   | El árbol existe en base con datos semilla; **sin pantalla, sin poder crear los propios** |
| A7  | **Presupuestos por rubro** — cuánto quiero gastar en cada cosa                       | Motor completo, cero interfaz                                                            |
| A8  | **Ajustes del hogar** — colchón, estrategia de deuda, tasa de reserva fiscal, moneda | Solo se tocan una vez en el cuestionario                                                 |

> **La regla que se rompió:** el cuestionario inicial es la única puerta de
> entrada para deudas, metas, ingresos y compromisos. Si te equivocaste, si algo
> cambió, o si lo saltaste — no hay vuelta. Un sistema financiero donde no podés
> corregir un dato es un sistema que vas a abandonar el primer mes.

### B. Ver y manejar el dinero

| #   | Falta                                                                                 |
| --- | ------------------------------------------------------------------------------------- |
| B1  | **Pantalla de movimientos**: lista, búsqueda, filtro por fecha/cuenta/rubro/monto     |
| B2  | **Editar un movimiento**: cambiar rubro, dividir entre rubros, excluir, anotar        |
| B3  | **Registrar un gasto a mano** — el que se pagó en efectivo y no sale en ningún estado |
| B4  | **Comercios**: normalización y regla "todo lo de Super 99 va a Mercado"               |
| B5  | **Transferencias entre cuentas propias**: confirmarlas para que no cuenten como gasto |
| B6  | **Duplicados**: la cola de revisión con el veredicto del motor                        |

### C. Documentos e importación — _lo que pediste del PDF y el OCR_

| #   | Falta                                                           | Nota                                                                                  |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C1  | **PDF con texto** — el estado de cuenta que baja del banco      | Extracción directa; es el caso más común y el más fácil                               |
| C2  | **OCR para escaneos y fotos** — la factura del súper, el recibo | Requiere motor de OCR y trabajos en segundo plano                                     |
| C3  | **XLSX**                                                        | Varios bancos panameños solo exportan Excel                                           |
| C4  | **Trabajos en segundo plano**                                   | Regla del proyecto: parsear un PDF **no puede** pasar dentro de una petición síncrona |
| C5  | **Plantillas por banco**                                        | Banco General, Banistmo, BAC tienen formatos distintos y estables                     |

### D. La inteligencia — _"no veo nada de AI"_

El motor de copiloto existe, tiene 31 pruebas, control de costo y guardarraíles.
**Está apagado**: `AI_PROVIDER=none` y no hay clave configurada. Por eso no ves
nada.

| #   | Falta                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Encender el copiloto**: clave de Anthropic + presupuesto mensual                                                                 |
| D2  | **Categorización automática visible**: que al confirmar una importación los rubros ya vengan puestos, con su confianza y su origen |
| D3  | **Detección de recurrentes**: "esto se repite cada mes, ¿lo registro como compromiso?"                                             |
| D4  | **Consejo en lenguaje natural**: qué hacer este mes, sobre las cifras ya calculadas                                                |
| D5  | **Alertas**: "a este ritmo no llegás al 30", "la tarjeta sube", "gastaste 40% más en X"                                            |
| D6  | **Chat**: preguntarle al sistema sobre tus propias finanzas                                                                        |

### E. Lo que hace que el hogar mejore de verdad

Esto es lo que señalaste como "el sistema fundamental" y es donde está el valor.

| #   | Falta                                                                        |
| --- | ---------------------------------------------------------------------------- |
| E1  | **Aceptar un plan** y que quede registrado como decisión, no como sugerencia |
| E2  | **Seguimiento**: ¿cumplí el plan del mes pasado?                             |
| E3  | **Simulador de deuda**: avalancha vs bola de nieve, con fechas y ahorro real |
| E4  | **Escenarios**: "¿y si me suben el sueldo?", "¿y si cambio de casa?"         |
| E5  | **Proyección**: cómo se ve el mes que viene y el siguiente                   |
| E6  | **Progreso de metas**: cuánto falta, a qué ritmo, cuándo llego               |
| E7  | **Reserva fiscal para independientes**: cuánto apartar de cada factura       |
| E8  | **Cierre de mes**: conciliar, cerrar, comparar                               |

### F. Multi-usuario, contador y negocio

| #   | Falta                                                                      |
| --- | -------------------------------------------------------------------------- |
| F1  | **Invitar a la pareja** — el flujo existe en base, sin envío de invitación |
| F2  | **Cambiar de hogar** cuando alguien pertenece a dos                        |
| F3  | **Invitar al contador** con alcance revocable                              |
| F4  | **Stripe**: cobrar de verdad; hoy el catálogo es una tabla                 |
| F5  | **Pantalla de suscripción**: plan actual, límites, subir de plan           |
| F6  | **Notificaciones**: correo y push, con `cron` para vencimientos            |

### G. Corregido hoy

| #   | Qué era                                                                                                                                                          | Estado                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| G1  | **Navegación lenta** — `loadSession()` corría dos veces por navegación, cada una con llamada de auth y transacción propia contra una base a ~400 ms de distancia | **Arreglado**: memoizada por render; una navegación pasa de ~6 idas y vueltas a ~3                          |
| G2  | **Dos cifras distintas con la misma etiqueta** — "Disponible para gastar" decía $3,400.25 en Posición y $2,740.25 en Plan                                        | **Arreglado**: ambas pantallas usan el mismo motor `computeSafeToSpend`. La cifra correcta es **$2,740.25** |

> **Sobre G2 y tu sospecha de que "el sistema no está conectado":** sí lo está.
> Las dos cifras salían de las mismas filas; la diferencia era que Posición
> restaba solo las obligaciones ($950) y Plan restaba además los mínimos de
> deuda ($160) y el colchón ($500). Ambos números eran correctos y la
> combinación era indefendible: **misma etiqueta, distinto número, es un
> defecto**, y tu conclusión de que algo estaba roto era la lectura razonable.

---

## 4. Modelo de negocio

El catálogo ya está en base de datos y el producto aplica los límites; lo que
falta es cobrar.

| Plan   | Precio     | Para quién                                                    |
| ------ | ---------- | ------------------------------------------------------------- |
| Free   | $0         | 1 persona, 250 movimientos/mes, 3 importaciones — para probar |
| Plus   | $9.99/mes  | 1 persona, ilimitado, 200 consultas de IA                     |
| Couple | $17.99/mes | 2 personas — **el plan ancla**, es el caso real de un hogar   |
| Pro    | $29.99/mes | 2 personas + **módulo fiscal** — el independiente             |
| Family | $39.99/mes | 6 personas + fiscal                                           |

**Dónde está el dinero.** Couple y Pro. Un hogar de dos ingresos paga $18 al mes
sin pensarlo si el producto le evita un solo cargo por sobregiro o le ordena una
tarjeta al 24.5%. El independiente paga $30 porque la reserva fiscal le ahorra
el susto de marzo.

**El canal que nadie está usando: los contadores.** Un contador con 30 clientes
independientes es un canal de distribución completo. El portal ya existe con
permisos revocables por alcance. Falta el flujo de invitación y un plan de
firma.

**Precios provisionales.** La página de precios lo dice explícitamente y debe
seguir diciéndolo hasta que haya datos de conversión reales.

**Lo que el producto nunca hará** (y conviene escribirlo antes de que alguien lo
proponga): vender datos, cobrar comisión por recomendar un producto financiero,
ni fabricar urgencia. El producto se paga solo si es útil.

---

## 5. Plan de acción: las 37 pantallas que faltan

El orden sale de una sola regla: **primero que el dato se pueda entrar y ver,
después que entre solo, después que el sistema aconseje, después que se cobre.**
Un motor sin pantalla no vale nada; una pantalla sobre datos que no se pueden
corregir se abandona el primer mes.

La numeración de cada pantalla es su lugar en las 43. La lista arranca en la 7
porque las seis primeras ya existen: posición, cuentas, importar, revisión de
importación, plan y estados.

| Fase | Pantallas | Avance al cerrar   | Bloqueada por             |
| ---- | --------- | ------------------ | ------------------------- |
| Hoy  | —         | 6 / 43 · 14%       | —                         |
| 1    | 12        | **18 / 43 · 42%**  | nada, empieza hoy         |
| 2    | 6         | 24 / 43 · 56%      | trabajos en segundo plano |
| 3    | 8         | 32 / 43 · 74%      | encender el copiloto      |
| 4    | 7         | 39 / 43 · 91%      | cuenta de Stripe          |
| 5    | 4         | **43 / 43 · 100%** | —                         |

### Fase 1 — Que el hogar se pueda administrar

Todo lo que hoy solo se toca una vez dentro del cuestionario y nunca más. Es la
fase que convierte una demostración en un sistema.

| №   | Pantalla               | Qué hace                                                                                    |
| --- | ---------------------- | ------------------------------------------------------------------------------------------- |
| 7   | **Movimientos**        | Lista con búsqueda y filtro por fecha, cuenta, rubro y monto. **La más urgente de las 37.** |
| 8   | **Movimiento**         | Detalle y edición: cambiar rubro, dividir entre varios, excluir, anotar.                    |
| 9   | **Gasto manual**       | Registrar el efectivo que no sale en ningún estado de cuenta.                               |
| 10  | **Ingresos**           | Lista y edición de salarios y otros ingresos, fijos o aproximados.                          |
| 11  | **Deudas**             | Lista y edición: saldo, tasa, pago mínimo, día de corte.                                    |
| 12  | **Deuda**              | Detalle: cuánto falta, cuánto se ha pagado, a qué ritmo se acaba.                           |
| 13  | **Metas**              | Lista y edición: monto objetivo, fecha, prioridad.                                          |
| 14  | **Meta**               | Detalle con progreso real contra lo aportado.                                               |
| 15  | **Compromisos**        | Lista y edición de obligaciones mensuales con su vencimiento.                               |
| 16  | **Rubros de gasto**    | El árbol de categorías, editable, con los propios del hogar.                                |
| 17  | **Miembros del hogar** | Quién vive aquí, quién depende de quién.                                                    |
| 18  | **Ajustes del hogar**  | Colchón, estrategia de deuda, tasa de reserva fiscal, moneda.                               |

**Al cerrar:** el producto pasa de «no puedo hacer nada» a «aquí vive el dinero
de la casa», y usarlo un mes sin tocar SQL se vuelve posible por primera vez.

### Fase 2 — Que los datos entren solos

Los trabajos en segundo plano van primero y bloquean al resto: parsear un PDF no
puede pasar dentro de una petición síncrona. Con eso resuelto, PDF, XLSX y OCR
son parsers que se agregan al pipeline que ya existe.

| №   | Pantalla                         | Qué hace                                                      |
| --- | -------------------------------- | ------------------------------------------------------------- |
| 19  | **Importación en proceso**       | Estado del trabajo, con su progreso y su error si falla.      |
| 20  | **Comercios**                    | Normalización y reglas: «todo lo de Super 99 va a Mercado».   |
| 21  | **Transferencias por confirmar** | Para que el pago de la tarjeta no cuente como gasto.          |
| 22  | **Duplicados**                   | La cola de revisión con el veredicto que el motor ya calcula. |
| 23  | **Recurrentes detectadas**       | «Esto se repite cada mes, ¿lo registro como compromiso?».     |
| 24  | **Categorización por revisar**   | Lo que el motor clasificó con poca confianza.                 |

**Al cerrar:** subir el estado de cuenta del banco en PDF y que los gastos queden
clasificados sin escribir nada.

### Fase 3 — Que el sistema aconseje

Encender el copiloto es configuración, no construcción: una clave de proveedor y
un presupuesto mensual. El motor ya tiene 31 pruebas, control de costo y
guardarraíles.

| №   | Pantalla                  | Qué hace                                                       |
| --- | ------------------------- | -------------------------------------------------------------- |
| 25  | **Presupuestos**          | Cuánto quiero gastar en cada rubro este mes.                   |
| 26  | **Presupuesto**           | Detalle: lo presupuestado contra lo gastado, día a día.        |
| 27  | **Consejo del mes**       | Qué hacer, escrito sobre las cifras que el motor ya calculó.   |
| 28  | **Alertas**               | «A este ritmo no llegás al 30», «gastaste 40% más en mercado». |
| 29  | **Simulador de deuda**    | Avalancha contra bola de nieve, con fechas y ahorro real.      |
| 30  | **Seguimiento del plan**  | Acepté esto el mes pasado, ¿lo cumplí?                         |
| 31  | **Constructor de reglas** | El editor visual sobre el motor de reglas que ya evalúa.       |
| 32  | **Chat**                  | Preguntarle al sistema sobre las finanzas propias.             |

**Al cerrar:** el producto deja de reportar y empieza a recomendar — que es la
razón por la que alguien paga por él.

### Fase 4 — Que se pueda cobrar y compartir

Hasta el primer cobro, todo el modelo de negocio es hipótesis. El catálogo, los
límites y los webhooks idempotentes ya están construidos y probados.

| №   | Pantalla                 | Qué hace                                                 |
| --- | ------------------------ | -------------------------------------------------------- |
| 33  | **Suscripción**          | Plan actual, límites consumidos, subir de plan.          |
| 34  | **Invitar miembros**     | Traer a la pareja al hogar.                              |
| 35  | **Accesos del contador** | Conceder y revocar por alcance.                          |
| 36  | **Selector de hogar**    | Para quien pertenece a dos.                              |
| 37  | **Notificaciones**       | Qué avisar, por dónde, con qué frecuencia.               |
| 38  | **Perfil fiscal**        | El régimen del independiente y su tasa.                  |
| 39  | **Reserva fiscal**       | Cuánto apartar de cada factura, y cuánto lleva apartado. |

**Al cerrar:** el producto cobra, y el canal de los contadores queda abierto.

### Fase 5 — Profundidad

Lo que separa una herramienta buena de una que se usa durante años. Los motores
de escenarios y de cierre ya existen y están probados.

| №   | Pantalla          | Qué hace                                                               |
| --- | ----------------- | ---------------------------------------------------------------------- |
| 40  | **Escenarios**    | «¿Y si me suben el sueldo?», «¿y si cambio de casa?».                  |
| 41  | **Proyección**    | Cómo se ve el mes que viene, y el siguiente, y el de dentro de un año. |
| 42  | **Cierre de mes** | Conciliar, cerrar y comparar contra el mes anterior.                   |
| 43  | **Exportaciones** | PDF y XLSX, además del CSV y JSON que ya salen.                        |

**Al cerrar:** 43 de 43. Queda pendiente lo que no es una pantalla — carga,
accesibilidad y rendimiento medidos, no supuestos.

## 6. Cómo se mide el avance

Cuatro cifras, revisadas al cerrar cada fase. Nada de porcentajes inventados.

1. **Tablas que un usuario puede crear Y editar desde el producto** — hoy
   **una**: `accounts`. Otras cinco (`goals`, `debts`, `obligations`,
   `recurring_series`, `household_settings`) solo se pueden crear una vez, en el
   cuestionario. Meta al cerrar Fase 1: **doce, todas editables**.
2. **Pasos del flujo dorado que un usuario completa sin ayuda** — hoy: registro,
   hogar, cuestionario, cuenta, importar, confirmar. Falta: ver, corregir,
   presupuestar, decidir, seguir.
3. **Tiempo hasta la primera cifra confiable** — desde el registro hasta que la
   pantalla de posición dice algo cierto. Hoy: ~4 minutos con el cuestionario.
4. **Un mes completo sin tocar SQL** — la prueba real. Hoy imposible: no hay
   dónde corregir un rubro.

---

## 7. Riesgos abiertos

- **Las credenciales de Supabase y R2 se pegaron en un chat y siguen sin
  rotar.** Es el riesgo abierto más grave del proyecto y no depende de ninguna
  fase.
- **El nombre "Cifrapp" es provisional** (ADR-001). Reemplazó a «Norte» el 7
  de septiembre de 2026 y sigue sin marca registrada.
- **El set de reglas fiscales de Panamá es un borrador sin revisar** y por eso no
  se le muestra a nadie. Antes de encender el módulo fiscal necesita revisión de
  un contador panameño con nombre y fecha.
- **Sin cuenta de Stripe** no hay forma de validar si alguien paga.
- **Rendimiento en producción**: la base está en `us-west-2` y cada ida y vuelta
  cuesta ~400 ms. La memoización de hoy ayuda; si el problema persiste, la
  siguiente medida es acercar el cómputo a la base o cachear la sesión en
  cookie firmada.
