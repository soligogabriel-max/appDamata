-- Origem por anúncio de quem chega pelo WhatsApp.
-- Quando a conversa nasce de um anúncio de clique-para-WhatsApp, a Meta manda
-- na primeira mensagem um objeto referral {source_type:'ad', source_id:<ad.id>,
-- ctwa_clid, headline, ...}. O webhook descartava isso e o lead ficava
-- invisível para o relatório de anúncios. Passa a ser guardado inteiro.
alter table wpp_mensagens add column if not exists referral jsonb;
create index if not exists idx_wpp_mensagens_referral_ad
  on wpp_mensagens ((referral->>'source_id')) where referral is not null;

-- relatorio_anuncios ganha a coluna wpp: telefones distintos cuja mensagem
-- recebida no período veio com referral daquele anúncio. Muda o tipo de
-- retorno, então é drop + create (create or replace não altera colunas OUT).
-- Substitui a definição de ads_insights.sql.
drop function if exists public.relatorio_anuncios(int);
create function public.relatorio_anuncios(p_dias int default 90)
returns table(ad_id text, ad_nome text, campanha text, gasto numeric,
              impressoes bigint, cliques bigint, disp bigint, orc bigint, vis bigint, wpp bigint)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz;
begin
  if coalesce(get_my_role(), '') not in ('admin', 'trafego') then
    raise exception 'sem permissão para o relatório de anúncios' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));
  return query
  with gasto as (
    select i.ad_id, max(i.ad_nome) ad_nome, max(i.campaign_nome) campanha,
           sum(i.gasto) gasto, sum(i.impressoes)::bigint impressoes, sum(i.cliques_link)::bigint cliques
      from ads_insights i where i.dia >= ini::date group by i.ad_id),
  atr as (
    select distinct on (s.session_id) s.session_id, s.utm_content ad_id
      from site_visits s
     where s.visited_at >= ini and s.utm_content ~ '^[0-9]+$'
     order by s.session_id, s.visited_at asc),
  d as (select a.ad_id, count(*) disp from atr a group by a.ad_id),
  o as (select a.ad_id, count(*) orc from orcamentos x join atr a on a.session_id = x.visitor_id
         where x.created_at >= ini group by a.ad_id),
  v as (select a.ad_id, count(*) vis from visitas_comerciais x join atr a on a.session_id = x.visitor_id
         where x.created_at >= ini and x.status is distinct from 'cancelada' group by a.ad_id),
  w as (select m.referral->>'source_id' ad_id,
               count(distinct regexp_replace(m.telefone, '\D', '', 'g')) wpp
          from wpp_mensagens m
         where m.direcao = 'recebida' and m.created_at >= ini and m.referral->>'source_id' is not null
         group by 1),
  ids as (select g.ad_id from gasto g union select d.ad_id from d union select w.ad_id from w)
  select i.ad_id, g.ad_nome, g.campanha,
         coalesce(g.gasto, 0), coalesce(g.impressoes, 0), coalesce(g.cliques, 0),
         coalesce(d.disp, 0), coalesce(o.orc, 0), coalesce(v.vis, 0), coalesce(w.wpp, 0)
    from ids i
    left join gasto g on g.ad_id = i.ad_id
    left join d on d.ad_id = i.ad_id
    left join o on o.ad_id = i.ad_id
    left join v on v.ad_id = i.ad_id
    left join w on w.ad_id = i.ad_id
   order by coalesce(g.gasto, 0) desc;
end $$;

revoke all on function public.relatorio_anuncios(int) from public, anon;
grant execute on function public.relatorio_anuncios(int) to authenticated;
