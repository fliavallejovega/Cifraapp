-- Qué regla produjo una línea del recibo, o ninguna.
--
-- El seguro social, el seguro educativo y la retención de renta no se eligen:
-- son un porcentaje del sueldo del período y salen de **cada** pago. Preguntar
-- en qué quincena sale el seguro social es ofrecer una decisión que no existe,
-- y una decisión que no existe puesta delante de alguien es una invitación a
-- responderla mal.
--
-- La cuota de la cooperativa, el préstamo o el seguro de vida sí se eligen,
-- porque el que los cobra decide cuándo. Esas son las líneas que el hogar
-- escribe a mano, y son las únicas que preguntan.
--
-- Así que la columna no guarda «es de ley» sino **de qué regla salió**, que es
-- la misma distinción dicha de forma útil: una línea con `rule_key` se puede
-- rastrear hasta el conjunto de reglas que la calculó, y una sin él es lo que
-- alguien copió de su papel. Nulo es lo segundo, y es lo que significaba cada
-- fila guardada antes de que esta columna existiera.

alter table app.income_deductions
  add column if not exists rule_key text
    check (rule_key is null or length(trim(rule_key)) between 1 and 80);

comment on column app.income_deductions.rule_key is
  'The tax rule this line was computed from, when it was computed rather than typed. Null means the household read it off their own payslip. A computed line comes off every payment by construction, so it never carries applies_to_anchors.';

-- Una línea calculada sale de todos los pagos por construcción. Guardar días
-- para ella sería guardar una respuesta a una pregunta que no se hizo.
alter table app.income_deductions
  drop constraint if exists income_deductions_rule_has_no_anchors;

alter table app.income_deductions
  add constraint income_deductions_rule_has_no_anchors
  check (rule_key is null or applies_to_anchors is null);
