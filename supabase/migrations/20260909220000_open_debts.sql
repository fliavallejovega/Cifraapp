-- Lo que se le debe a una persona o a un proveedor, sin fecha.
--
-- «Le debo doscientos a mi hermano» y «le debo cuatrocientos al del taller» son
-- deudas reales del hogar y no caben en ninguna forma con calendario: no tienen
-- cuota, ni mínimo, ni día. Se deben, y se pagan cuando se pueda.
--
-- Faltaban por partida doble. No había cómo decir que una deuda es informal, y
-- la forma de pago más parecida —un solo pago al vencimiento— supone un
-- vencimiento que aquí no existe. Sin las dos, este dinero no se podía anotar
-- sin inventarle una fecha, y una casa que no lo anota lo olvida hasta que se
-- lo reclaman.

alter type app.debt_kind add value if not exists 'informal';
alter type app.debt_repayment add value if not exists 'open';
