-- Métricas diárias por anúncio, puxadas da Marketing API da Meta.
-- Existe porque o funil até o contrato mora aqui e o gasto mora lá: sem juntar
-- os dois não dá para dizer o custo por orçamento de cada anúncio.
--
-- Chave em (dia, ad_id): a função reprocessa os últimos dias a cada execução,
-- porque a Meta revisa números por alguns dias depois do fato.

create table if not exists ads_insights (
  dia             date    not null,
  ad_id           text    not null,
  account_id      text    not null,
  campaign_id     text,
  campaign_nome   text,
  adset_id        text,
  adset_nome      text,
  ad_nome         text,
  gasto           numeric(12,2) not null default 0,
  impressoes      integer not null default 0,
  alcance         integer not null default 0,
  cliques         integer not null default 0,
  cliques_link    integer not null default 0,
  sincronizado_em timestamptz not null default now(),
  primary key (dia, ad_id)
);

create index if not exists idx_ads_insights_dia on ads_insights(dia desc);
create index if not exists idx_ads_insights_campaign on ads_insights(campaign_id);

-- Sem política para anon: nenhum fluxo público lê custo de anúncio.
-- A função de sincronismo escreve com service role, que não passa por RLS.
alter table ads_insights enable row level security;

drop policy if exists ads_insights_admin on ads_insights;
create policy ads_insights_admin on ads_insights
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');

revoke all on ads_insights from anon;
