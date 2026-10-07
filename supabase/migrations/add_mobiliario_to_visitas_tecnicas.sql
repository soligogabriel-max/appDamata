-- Mobiliário na visita técnica: quantidade adicional e observações.
--
-- Na VT a equipe precisa saber quanto mobiliário o evento já tem pelo contrato
-- (mesas, cadeiras Tiffany, bancos, balcão hexagonal) e quanto será acrescido
-- fora dele, além de onde cada coisa vai ser usada.
--
-- As quantidades DO CONTRATO não entram aqui de propósito: elas vivem em
-- agenda.spaces_json (chaves mesas/cad/ban/fuBal), que os aditivos já somam.
-- Copiá-las para a VT criaria uma segunda verdade que silenciosamente
-- envelhece — um aditivo posterior deixaria a VT mostrando o número antigo.
-- A VT lê o spaces_json na hora de abrir.
--
-- Só o que é da visita fica na visita: o acréscimo combinado nela e a
-- observação de onde o mobiliário será usado.
--
-- Todas aditivas e nullable: as VTs existentes seguem válidas sem preencher
-- nada, e o saveVT envia as colunas explicitamente.

alter table visitas_tecnicas add column if not exists mob_mesas_add integer;
alter table visitas_tecnicas add column if not exists mob_cad_add integer;
alter table visitas_tecnicas add column if not exists mob_ban_add integer;
alter table visitas_tecnicas add column if not exists mob_bal_add integer;
alter table visitas_tecnicas add column if not exists mob_obs text;

-- PostgREST cacheia o schema; sem isso as colunas novas só apareceriam no
-- próximo reload do serviço.
notify pgrst, 'reload schema';
