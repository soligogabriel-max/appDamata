-- Detalhe dos contratos fechados: quanto tempo levou e de onde veio cada um.
--
-- Classificação da origem, do mais específico para o mais genérico:
--   1. sem orçamento de origem  -> entrou por fora (indicação, telefone)
--   2. orçamento feito num aparelho da equipe -> a pessoa não chegou pelo site;
--      alguém da casa montou o orçamento para ela
--   3. orçamento do cliente com utm_content numérico -> veio daquele anúncio
--   4. orçamento do cliente sem utm -> site, mas direto ou orgânico
--
-- "Aparelho da equipe" é deduzido: identificador de navegador que aparece em
-- orçamentos de 5 ou mais clientes diferentes. Não há campo marcando isso — o
-- wizard é o mesmo para cliente e equipe. Hoje um aparelho tem 26 orçamentos
-- de 20 clientes e o segundo colocado tem 2, então o corte separa limpo.
-- Sem essa distinção, três contratos apareceriam como "site sem anúncio",
-- sugerindo tráfego orgânico onde na verdade foi atendimento humano.

create or replace function public.funil_fechados(p_dias int default 90)
returns table(
  cod text, nome_evento text, fechado_em date, dias_ate_fechar int,
  origem text, ad_nome text
)
language plpgsql stable security definer set search_path = public as $$
declare ini timestamptz;
begin
  -- Sem 'trafego' aqui: esta lista traz nome de evento, que é nome de cliente.
  if coalesce(get_my_role(), '') not in ('admin', 'equipe') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  ini := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 90), 365)));

  return query
  with equipe as (
    select o.visitor_id from orcamentos o
     where o.visitor_id is not null
     group by o.visitor_id having count(distinct o.whatsapp) >= 5),
  -- primeiro acesso da sessão: é o clique que trouxe a pessoa
  atr as (
    select distinct on (s.session_id) s.session_id, s.utm_content ad
      from site_visits s where s.utm_content ~ '^[0-9]+$'
     order by s.session_id, s.visited_at asc)
  select a.cod,
         a.nome_evento,
         a.created_at::date,
         (a.created_at::date - o.created_at::date)::int,
         case
           when a.orc_id is null then 'fora do site'
           when e.visitor_id is not null then 'orçamento feito pela equipe'
           when atr.ad is not null then 'anúncio'
           else 'site, sem anúncio'
         end,
         (select max(i.ad_nome) from ads_insights i where i.ad_id = atr.ad)
    from agenda a
    left join orcamentos o on o.id = a.orc_id
    left join equipe e on e.visitor_id = o.visitor_id
    left join atr on atr.session_id = o.visitor_id
   where a.deleted_at is null and a.created_at >= ini
   order by a.created_at desc;
end $$;

revoke all on function public.funil_fechados(int) from public, anon;
grant execute on function public.funil_fechados(int) to authenticated;
