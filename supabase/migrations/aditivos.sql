-- Aditivos de contrato.
--
-- Um aditivo e um segundo documento pendurado no evento: o contrato original
-- ja foi para assinatura (ou ja foi assinado) e nao pode mais ser reaberto —
-- contrato-publico recusa o link fora de null/gerado/dados_preenchidos, e o
-- PDF que esta no Autentique nao muda. O que se inclui depois vive aqui.
--
-- Espelha a estrutura do contrato em agenda: token uuid para o link publico,
-- os mesmos assinatura_* que o Autentique alimenta, cliente_json com o que o
-- cliente digitou, e soft-delete como o resto do sistema.

create table if not exists public.aditivos (
  id                 bigserial primary key,
  cod_evento         text not null references public.agenda(cod) on update cascade,
  -- sequencial por evento: "1o Termo Aditivo", "2o Termo Aditivo"...
  numero             int  not null,
  -- uuid pelo mesmo motivo de contrato_token: cod e sequencial e enumeravel
  token              uuid not null default gen_random_uuid(),
  justificativa      text,
  itens_json         text,           -- itens incluidos (formato de preset.itens)
  alteracoes_json    text,           -- de-para de datas/espacos/acomodacoes
  payments_json      text,           -- parcelas do aditivo
  valor              numeric default 0,
  assinatura_status  text,           -- null/gerado/dados_preenchidos/enviado/assinado
  assinatura_doc_id  text,
  assinatura_pdf_url text,
  contrato_ok        boolean default false,
  cliente_json       jsonb,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  deleted_at         timestamptz
);

-- Numero unico por evento, ignorando os apagados: aditivo removido nao trava
-- a sequencia, mesma logica de proximo_cod_contrato para os codigos.
create unique index if not exists aditivos_evento_numero_uq
  on public.aditivos (cod_evento, numero) where deleted_at is null;

create unique index if not exists aditivos_token_uq on public.aditivos (token);
create index if not exists aditivos_cod_evento_ix on public.aditivos (cod_evento);

alter table public.aditivos enable row level security;

-- Mesma politica de contas_a_receber: admin faz tudo; assessoria enxerga os
-- aditivos dos eventos dela. O fluxo publico (link do cliente) nao passa por
-- aqui — aditivo-publico usa a service role, como contrato-publico.
drop policy if exists aditivos_admin on public.aditivos;
create policy aditivos_admin on public.aditivos
  for all to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

drop policy if exists aditivos_assessoria_select on public.aditivos;
create policy aditivos_assessoria_select on public.aditivos
  for select to authenticated
  using (
    get_my_role() = 'assessoria'
    and exists (
      select 1 from public.agenda a
      where a.cod = aditivos.cod_evento
        and a.assessoria_cod is not null
        and a.assessoria_cod::text = get_my_assessoria_cod()
    )
  );

-- Proximo numero de aditivo do evento. Fica no banco pelo mesmo motivo de
-- proximo_cod_contrato: em JS, duas abas abertas geram o mesmo numero.
create or replace function public.proximo_num_aditivo(p_cod text)
returns int
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(max(numero), 0) + 1 from public.aditivos where cod_evento = p_cod;
$$;

-- O anon nao tem nada a fazer aqui. O link do cliente passa por
-- aditivo-publico, que usa a service role — como contrato-publico. Fechar
-- agora, com a tabela recem-criada e nenhum fluxo anon apontando para ela,
-- e barato; nas tabelas antigas o REVOKE ainda exige exercitar os fluxos
-- publicos um a um (ver CLAUDE.md).
revoke all on public.aditivos from anon;
revoke all on sequence public.aditivos_id_seq from anon;

-- Parcelas nascidas de aditivo precisam ser distinguiveis das do contrato.
-- sincronizarParcelasReceber() (admin.html) reconcilia as parcelas do evento
-- pelo numero e trata como sobra tudo que passa do fim da lista — sem esta
-- coluna, a primeira edicao do evento apagaria em silencio todo o
-- parcelamento dos aditivos.
alter table public.contas_a_receber
  add column if not exists aditivo_id bigint references public.aditivos(id);

create index if not exists contas_a_receber_aditivo_ix
  on public.contas_a_receber (aditivo_id) where aditivo_id is not null;

-- Funcao tem EXECUTE para PUBLIC por padrao: revogar so do anon nao fecha nada.
revoke all on function public.proximo_num_aditivo(text) from public, anon;
grant execute on function public.proximo_num_aditivo(text) to authenticated, service_role;
