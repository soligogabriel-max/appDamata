-- ═══════════════════════════════════════════════════════════════════
-- CONCILIAÇÃO N:N — extrato bancário × contas a receber
--
-- Antes: o vínculo morava em extrato_bancario.titulo_a_receber (uma
-- coluna, um valor por linha do extrato). Isso só representa 1:1.
-- Os dois casos reais que faltavam:
--   • uma movimentação paga dois títulos  -> impossível (coluna única)
--   • duas movimentações pagam um título  -> a soma até funcionava, mas
--     o seletor escondia título já conciliado e o status virava PAGO
--     na primeira metade
-- Falta nos dois a mesma informação: QUANTO daquela movimentação foi
-- para AQUELE título. É o que esta tabela guarda.
--
-- contas_a_receber.status continua PAGO/NP e continua sendo a verdade
-- lida pelo resto do app (modal do evento, ficha, painel, relatórios).
-- Só deixa de ser digitado na conciliação: o trigger abaixo recalcula
-- a partir da soma alocada.
-- ═══════════════════════════════════════════════════════════════════

-- id_extrato_c6 é como o app endereça a linha do extrato (PATCH/DELETE
-- usam ele, não o id). Já é único nas 842 linhas; o índice formaliza
-- isso, permite a FK e ainda barra importação duplicada.
create unique index if not exists extrato_bancario_id_c6_uk
  on public.extrato_bancario (id_extrato_c6);

create table if not exists public.conciliacao_receber (
  id         bigserial primary key,
  extrato_id text        not null references public.extrato_bancario(id_extrato_c6) on delete cascade,
  titulo_id  integer     not null references public.contas_a_receber(id)            on delete cascade,
  valor      numeric(14,2) not null check (valor > 0),
  created_at timestamptz not null default now(),
  unique (extrato_id, titulo_id)
);

create index if not exists idx_concrec_titulo on public.conciliacao_receber (titulo_id);

comment on table  public.conciliacao_receber is 'Rateio N:N entre movimentações do extrato e títulos a receber. valor = quanto DESTA movimentação foi para ESTE título.';
comment on column public.conciliacao_receber.valor is 'Parte da entrada alocada a este título. A soma por movimentação não passa da entrada; a soma por título não passa do valor do título (tolerância de 2 centavos).';

-- ── status derivado ────────────────────────────────────────────────
-- Recalcula um título a partir das alocações. Tolerância de 2 centavos,
-- a mesma que _matchEntradas já usa no casamento automático.
create or replace function public.recalc_status_receber(p_titulo integer)
returns void language plpgsql as $$
declare
  v_valor numeric;
  v_soma  numeric;
  v_data  date;
  v_quit  boolean;
begin
  select valor into v_valor from public.contas_a_receber where id = p_titulo;
  if not found then return; end if;

  select coalesce(sum(c.valor),0), max(e.data_lancamento)
    into v_soma, v_data
    from public.conciliacao_receber c
    join public.extrato_bancario e on e.id_extrato_c6 = c.extrato_id
   where c.titulo_id = p_titulo;

  v_quit := coalesce(v_valor,0) > 0 and v_soma >= v_valor - 0.02;

  update public.contas_a_receber set
    status        = case when v_quit then 'PAGO' else 'NP' end,
    conciliado    = v_soma > 0,
    data_recebido = case when v_quit then v_data else null end,
    updated_at    = now()
  where id = p_titulo;
end $$;

create or replace function public.trg_conciliacao_receber_recalc()
returns trigger language plpgsql as $$
begin
  -- new nulo = remoção; old nulo = inclusão (as colunas são NOT NULL,
  -- então o record só é nulo quando a operação não o preenche).
  if new is null then
    perform public.recalc_status_receber(old.titulo_id);
    return old;
  end if;
  if old is not null and old.titulo_id <> new.titulo_id then
    perform public.recalc_status_receber(old.titulo_id);
  end if;
  perform public.recalc_status_receber(new.titulo_id);
  return new;
end $$;

-- ── as duas regras do rateio ───────────────────────────────────────
-- São regras entre linhas, então CHECK não alcança: ficam num trigger
-- BEFORE. O wizard valida antes; isto é a rede embaixo.
create or replace function public.trg_conciliacao_receber_valida()
returns trigger language plpgsql as $$
declare
  v_titulo  numeric;
  v_entrada numeric;
  v_outros  numeric;
begin
  select valor into v_titulo from public.contas_a_receber where id = new.titulo_id;

  select coalesce(sum(valor),0) into v_outros
    from public.conciliacao_receber
   where titulo_id = new.titulo_id and id <> coalesce(new.id, -1);
  if v_outros + new.valor > coalesce(v_titulo,0) + 0.02 then
    raise exception 'Rateio acima do titulo %: ja alocado % mais % passa de %',
      new.titulo_id, v_outros, new.valor, v_titulo;
  end if;

  select coalesce(entrada,0) into v_entrada
    from public.extrato_bancario where id_extrato_c6 = new.extrato_id;

  select coalesce(sum(valor),0) into v_outros
    from public.conciliacao_receber
   where extrato_id = new.extrato_id and id <> coalesce(new.id, -1);
  if v_outros + new.valor > v_entrada + 0.02 then
    raise exception 'Rateio acima da movimentacao %: ja alocado % mais % passa da entrada %',
      new.extrato_id, v_outros, new.valor, v_entrada;
  end if;

  return new;
end $$;

-- ── RLS: mesma porta de contas_a_receber e extrato_bancario ────────
-- Só admin. Assessoria não vê conciliação, anon não encosta.
alter table public.conciliacao_receber enable row level security;

drop policy if exists conciliacao_receber_admin on public.conciliacao_receber;
create policy conciliacao_receber_admin on public.conciliacao_receber
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

-- Assessoria enxerga o rateio dos títulos que já enxerga: a mesma
-- condição da política de contas_a_receber. Sem isto, para ela um
-- título recebido em parte pareceria intocado.
drop policy if exists conciliacao_receber_assessoria_select on public.conciliacao_receber;
create policy conciliacao_receber_assessoria_select on public.conciliacao_receber
  for select to authenticated
  using (get_my_role() = 'assessoria' and exists (
    select 1 from public.contas_a_receber r
      join public.agenda a on a.cod = r.cod_evento
     where r.id = conciliacao_receber.titulo_id
       and a.assessoria_cod is not null
       and (a.assessoria_cod)::text = get_my_assessoria_cod()));

grant select, insert, update, delete on public.conciliacao_receber to authenticated;
grant usage, select on sequence public.conciliacao_receber_id_seq to authenticated;
revoke all on public.conciliacao_receber from anon;
revoke all on sequence public.conciliacao_receber_id_seq from anon;

-- ── migração dos 56 vínculos que já existiam ───────────────────────
-- least(entrada, valor): em 6 casos a movimentação é maior que o título
-- (R$ 2.246,40 no total) — justamente o caso "uma movimentação pagou
-- mais de um título" em que só um foi vinculado. A sobra fica visível
-- como não alocada, em vez de sumir dentro do título.
insert into public.conciliacao_receber (extrato_id, titulo_id, valor)
select e.id_extrato_c6, r.id, least(e.entrada, r.valor)
  from public.extrato_bancario e
  join public.contas_a_receber r on r.id::text = e.titulo_a_receber
 where e.titulo_a_receber is not null
   and coalesce(e.entrada,0) > 0
   and coalesce(r.valor,0)   > 0
on conflict (extrato_id, titulo_id) do nothing;

-- Triggers só depois da carga: assim a migração não mexe no status de
-- nenhum dos 56 (todos ficam quitados, como já estavam).
drop trigger if exists conciliacao_receber_valida on public.conciliacao_receber;
create trigger conciliacao_receber_valida
  before insert or update on public.conciliacao_receber
  for each row execute function public.trg_conciliacao_receber_valida();

drop trigger if exists conciliacao_receber_recalc on public.conciliacao_receber;
create trigger conciliacao_receber_recalc
  after insert or update or delete on public.conciliacao_receber
  for each row execute function public.trg_conciliacao_receber_recalc();

notify pgrst, 'reload schema';

-- ── grafia do status ───────────────────────────────────────────────
-- 33 títulos vinham da importação de 2026-06-16 com 'pago' minúsculo, e
-- o filtro "Pago" da tela consultava status=eq.PAGO — escondia esses
-- R$ 19.307,57. Agora quem escreve status é o trigger acima, que só
-- produz PAGO/NP; isto acerta o passado.
update public.contas_a_receber set status='PAGO' where status='pago';
