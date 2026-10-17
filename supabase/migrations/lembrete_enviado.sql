-- Quando o lembrete da véspera foi efetivamente entregue ao cliente.
--
-- Serve para a aba Agendadas só cobrar resposta de quem foi perguntado: antes
-- disso o cliente não recebeu link nenhum, e marcar "sem confirmação" seria
-- acusá-lo de não responder uma pergunta que ninguém fez.
--
-- Gravado só quando a Meta aceita a mensagem. Visita marcada depois das 9h da
-- véspera não chega a receber lembrete, e fica corretamente sem nada.

ALTER TABLE visitas_comerciais
  ADD COLUMN IF NOT EXISTS lembrete_em timestamptz;

COMMENT ON COLUMN visitas_comerciais.lembrete_em IS
  'Quando o lembrete da véspera foi enviado por WhatsApp. Nulo = cliente ainda não recebeu o link. Zerado ao remarcar.';
