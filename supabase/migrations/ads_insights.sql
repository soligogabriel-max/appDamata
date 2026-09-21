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

-- Autenticação do cron para a função sync-meta-ads.
-- O segredo em si NÃO fica aqui: é gerado dentro do banco e gravado como
-- setting de database (app.sync_meta_ads_secret), para que nem o job do cron
-- nem o repositório carreguem o valor. Para (re)gerar:
--   do $$ declare s text; begin
--     s := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
--     execute format('alter database postgres set app.sync_meta_ads_secret = %L', s);
--   end $$;
create or replace function public.sync_meta_ads_auth(p_token text)
returns boolean language sql stable set search_path = public as $f$
  select p_token is not null
     and length(p_token) > 20
     and p_token = current_setting('app.sync_meta_ads_secret', true)
$f$;

revoke all on function public.sync_meta_ads_auth(text) from public, anon, authenticated;
grant execute on function public.sync_meta_ads_auth(text) to service_role;
