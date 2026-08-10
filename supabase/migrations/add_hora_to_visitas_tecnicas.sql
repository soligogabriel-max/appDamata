-- Hora da visita técnica.
--
-- visitas_tecnicas guardava só data_vt (date). Uma VT é marcada num horário —
-- os fornecedores precisam saber a que horas chegar — e esse dado vinha ficando
-- solto na obs de alguma linha ou fora do sistema.
--
-- Aditiva e nullable: as VTs já existentes continuam válidas sem hora, e o
-- saveVT envia as colunas explicitamente, então nada quebra sem a coluna
-- preenchida.

alter table visitas_tecnicas add column if not exists hora time;

-- PostgREST cacheia o schema; sem isso a coluna nova só apareceria no próximo
-- reload do serviço.
notify pgrst, 'reload schema';
