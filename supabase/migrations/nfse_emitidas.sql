-- Controle de notas fiscais (NFS-e) por evento.
--
-- Ate aqui o controle vivia numa planilha exportada do FileMaker (Cod,
-- Numero, Serie, Valor NF, Data NF). O app tinha o botao "Emitir NFS-e", mas
-- nada gravava o que foi emitido: fechou a janela, perdeu o numero. A coluna
-- agenda.nf existe no banco e nenhum codigo usa.
--
-- Uma linha por nota. Um evento pode ter mais de uma (reemissao, nota
-- complementar), e a serie distingue a numeracao antiga da prefeitura ("E")
-- da numeracao do portal nacional (DPS serie "70000", NFS-e numero 1...).
-- rls_security_migration.sql ja referenciava nfse_emitidas sem a tabela
-- existir — este arquivo e o que cria.

create table if not exists public.nfse_emitidas (
  id                 bigserial primary key,
  cod_evento         text not null references public.agenda(cod) on update cascade,
  numero             integer not null,
  serie              text,
  valor              numeric not null default 0,
  data_emissao       date not null,
  -- 50 digitos do portal nacional; no SigISS era o codigo de verificacao
  chave_acesso       text,
  pdf_url            text,
  obs                text,
  -- manual (registrada no admin) | planilha (importacao inicial) | sigiss (edge function)
  origem             text not null default 'manual',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  deleted_at         timestamptz
);

-- Numero unico dentro da serie, ignorando apagadas: registrar errado e apagar
-- nao trava o numero certo.
create unique index if not exists nfse_emitidas_serie_numero_uq
  on public.nfse_emitidas (coalesce(serie,''), numero) where deleted_at is null;
create index if not exists nfse_emitidas_cod_evento_ix on public.nfse_emitidas (cod_evento);

alter table public.nfse_emitidas enable row level security;

-- Dado fiscal: so admin. Assessoria e fornecedor nao tem por que ver a nota
-- do cliente. O anon nunca chega aqui (nenhum fluxo publico usa a tabela).
drop policy if exists "staff_all_nfse_emitidas" on public.nfse_emitidas;
drop policy if exists nfse_emitidas_admin on public.nfse_emitidas;
create policy nfse_emitidas_admin on public.nfse_emitidas
  for all to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');

revoke all on public.nfse_emitidas from anon;
revoke all on public.nfse_emitidas_id_seq from anon;
