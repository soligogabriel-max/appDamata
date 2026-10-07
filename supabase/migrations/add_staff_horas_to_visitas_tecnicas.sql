-- Staff e horas extras na visita técnica.
--
-- Mesmo esquema do mobiliário: a quantidade contratada vem de
-- agenda.spaces_json (chaves staff e horas, as mesmas que o quadro do evento
-- usa) e aqui fica só o adicional combinado na visita.
--
-- Nota sobre os dados: das 271 agendas com spaces_json, só 3 trazem a chave
-- staff e 24 a chave horas — a maioria não tem a chave nenhuma. A leitura
-- trata chave ausente como 0, que é o que ela significa: nada contratado.
--
-- Aditivas e nullable, como as demais colunas mob_.

alter table visitas_tecnicas add column if not exists mob_staff_add integer;
alter table visitas_tecnicas add column if not exists mob_horas_add integer;

-- PostgREST cacheia o schema; sem isso as colunas novas só apareceriam no
-- próximo reload do serviço.
notify pgrst, 'reload schema';
