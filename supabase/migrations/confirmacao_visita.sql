-- Quando o cliente clica em "Confirmar presença" no link do lembrete.
--
-- O botão existia desde o começo, mas só devolvia uma página de agradecimento:
-- nada era gravado, então a equipe não tinha como saber quem confirmou. Era
-- confirmação só para o cliente se sentir atendido.
--
-- Timestamp em vez de boolean: saber QUANDO confirmou importa. Confirmação de
-- três semanas atrás, antes de uma remarcação, não vale o mesmo que a de
-- ontem — e por isso remarcar limpa o campo.

ALTER TABLE visitas_comerciais
  ADD COLUMN IF NOT EXISTS confirmada_em timestamptz;

COMMENT ON COLUMN visitas_comerciais.confirmada_em IS
  'Quando o cliente confirmou presença pelo link do lembrete. Nulo = sem resposta. Zerado ao remarcar.';
