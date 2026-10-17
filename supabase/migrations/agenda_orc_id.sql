-- Liga o evento ao orçamento que o originou.
--
-- Sem isso o funil para na última etapa: dá para contar quantos contratos
-- fecharam, mas não quantos vieram do site. Não havia nenhuma coluna ligando
-- agenda a orcamentos ou visitas_comerciais.
--
-- Preenchido no fluxo "Efetivar orçamento": o id viaja do orçamento para o
-- gerador de contrato e volta no preset que grava o evento. Evento criado
-- direto na agenda (cliente que chegou por indicação, telefone) fica nulo —
-- e isso é informação, não falha.

ALTER TABLE agenda ADD COLUMN IF NOT EXISTS orc_id bigint;

CREATE INDEX IF NOT EXISTS agenda_orc_id_idx ON agenda (orc_id) WHERE orc_id IS NOT NULL;

COMMENT ON COLUMN agenda.orc_id IS
  'Orçamento que originou o evento. Nulo = veio por fora do site (indicação, telefone).';
