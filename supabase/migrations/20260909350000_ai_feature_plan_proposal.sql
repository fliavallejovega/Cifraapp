-- El catálogo de funciones de IA gana el miembro que produce las propuestas.
--
-- En su propio archivo porque `alter type ... add value` no permite usar el
-- valor nuevo en la misma transacción que lo crea. Separarlo evita que una
-- migración que lo añada y lo use a la vez falle en el despliegue y no en local.
alter type app.ai_feature add value if not exists 'plan_proposal' after 'rule_proposal';
