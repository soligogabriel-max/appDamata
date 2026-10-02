-- Resumo mensal do relatório de visitas, para os cards do topo mostrarem os
-- últimos meses e não só o anterior.
--
-- Por que no banco: um mês passa de 6 mil visitas. Trazer três meses de linhas
-- cruas só para somar quatro números no navegador seriam ~18 mil registros e
-- 18 páginas de REST a cada abertura da aba — no celular isso custa caro.
-- Aqui volta uma linha por mês.
--
-- As definições espelham o que o admin.html já fazia para "mês passado", para
-- card e tabela não discordarem:
--   visitas  = linhas de site_visits
--   únicos   = session_id distintos
--   orçamentos = pessoas distintas (orcPessoaKey: WhatsApp sem +55; na falta,
--                visitor_id; na falta, o id da linha)
--   marcadas = visitas comerciais não canceladas
-- O mês é o local (America/Sao_Paulo), como o utcToLocalDate do cliente.

create or replace function public.resumo_mensal_site(p_meses int default 4)
returns table(mes text, visitas bigint, unicos bigint, orcamentos bigint, marcadas bigint)
language plpgsql stable security definer set search_path = public as $$
declare ini date;
begin
  if coalesce(get_my_role(), '') not in ('admin', 'equipe') then
    raise exception 'sem permissão para o resumo de visitas' using errcode = '42501';
  end if;

  -- Primeiro dia do mês, p_meses-1 meses atrás: p_meses=4 cobre o mês corrente
  -- mais os três anteriores.
  ini := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)
         - make_interval(months => greatest(1, least(coalesce(p_meses, 4), 24)) - 1);

  return query
  with v as (
    select to_char((s.visited_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') m,
           s.session_id
      from site_visits s
     where (s.visited_at at time zone 'America/Sao_Paulo')::date >= ini),
  vis as (
    select m, count(*) visitas, count(distinct session_id) unicos from v group by m),
  -- Mesma chave de pessoa do cliente: 3 simulações do mesmo casal são 1.
  o as (
    select to_char((x.created_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') m,
           case
             when length(regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g')) > 11
              and left(regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g'), 2) = '55'
              and length(substr(regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g'), 3)) >= 10
               then 'w:' || substr(regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g'), 3)
             when length(regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g')) between 10 and 11
               then 'w:' || regexp_replace(coalesce(x.whatsapp, ''), '\D', '', 'g')
             when x.visitor_id is not null then 'v:' || x.visitor_id
             else 'i:' || x.id::text
           end pessoa
      from orcamentos x
     where (x.created_at at time zone 'America/Sao_Paulo')::date >= ini),
  orc as (select m, count(distinct pessoa) orcamentos from o group by m),
  mc as (
    select to_char((x.created_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM') m,
           count(*) marcadas
      from visitas_comerciais x
     where (x.created_at at time zone 'America/Sao_Paulo')::date >= ini
       and x.status is distinct from 'cancelada'
     group by 1)
  select coalesce(vis.m, orc.m, mc.m),
         coalesce(vis.visitas, 0), coalesce(vis.unicos, 0),
         coalesce(orc.orcamentos, 0), coalesce(mc.marcadas, 0)
    from vis
    full join orc on orc.m = vis.m
    full join mc  on mc.m  = coalesce(vis.m, orc.m)
   order by 1 desc;
end $$;

-- security definer: quem chama não precisa de leitura em orcamentos (nome,
-- WhatsApp, valor) para ver uma contagem.
revoke all on function public.resumo_mensal_site(int) from public, anon;
grant execute on function public.resumo_mensal_site(int) to authenticated;
