-- Link do orçamento deixa de ser enumerável.
--
-- O link enviado por WhatsApp era fazendadamata.com/orcamento.html?id=764, e
-- `id` é bigint sequencial: trocando o número dava para abrir o orçamento de
-- qualquer outro cliente (nome, WhatsApp, e-mail, data do evento, itens e
-- valores). Um cliente reportou em 28/10/2026. A tabela em si nunca esteve
-- aberta — o RLS segura o anon; quem lia era a Edge Function orcamento-publico,
-- que consulta com service role e só olhava o id.
--
-- Mesmo raciocínio já aplicado em agenda.contrato_token: identificador público
-- tem que ser aleatório, não sequencial.

alter table public.orcamentos
  add column if not exists token uuid not null default gen_random_uuid();

create unique index if not exists orcamentos_token_key on public.orcamentos(token);
