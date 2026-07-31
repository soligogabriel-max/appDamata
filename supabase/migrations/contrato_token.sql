-- Link público do contrato — etapa 1
-- Executado em 2026-07-31.
--
-- O contrato deixa de ser um arquivo HTML solto enviado por WhatsApp e passa
-- a ser um link, para que os dados do cliente caiam na base antes da
-- assinatura (hoje eles só existem dentro do PDF que vai ao Autentique:
-- cliente_json está nulo em todos os contratos já emitidos).
--
-- O endereço é um uuid, não o cod: cod é sequencial de 6 dígitos (202624,
-- 202625, ...) e qualquer um enumeraria os contratos de todos os eventos.
--
-- Não precisa de coluna de expiração: assinar-contrato já grava
-- assinatura_status='enviado' quando o Autentique aceita, e a Edge Function
-- contrato-publico só serve enquanto o status for null/gerado/dados_preenchidos.

ALTER TABLE public.agenda
  ADD COLUMN IF NOT EXISTS contrato_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS agenda_contrato_token_key
  ON public.agenda (contrato_token);

-- Nenhum GRANT para anon: quem lê o token é a Edge Function, com service role.
-- Verificado após execução: 284 linhas, 284 tokens distintos, nenhum nulo,
-- e a leitura anônima de agenda continua devolvendo vazio.
