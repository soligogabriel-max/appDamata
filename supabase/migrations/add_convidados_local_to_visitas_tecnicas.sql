-- Número de convidados e local da cerimônia na visita técnica.
--
-- Os dois já eram informação de VT, mas não tinham onde morar: vinham sendo
-- digitados na observação de alguma linha de fornecedor ("100 convidados",
-- "cerimônia no gramado"), onde não dá para filtrar, somar nem destacar na
-- ficha que vai para o fornecedor.
--
-- local_cerimonia guarda a opção escolhida (Coberto / Gramado / Capela / Outro)
-- e local_cerimonia_outro o complemento quando é "Outro" — sozinha, a opção
-- "Outro" não diz nada a quem lê a ficha.
--
-- Todas aditivas e nullable: as VTs existentes seguem válidas sem preencher
-- nada, e o saveVT envia as colunas explicitamente.

alter table visitas_tecnicas add column if not exists num_convidados integer;
alter table visitas_tecnicas add column if not exists local_cerimonia text;
alter table visitas_tecnicas add column if not exists local_cerimonia_outro text;

-- PostgREST cacheia o schema; sem isso as colunas novas só apareceriam no
-- próximo reload do serviço.
notify pgrst, 'reload schema';
