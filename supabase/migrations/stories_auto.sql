-- Stories automáticos: todo dia um post do próprio feed vira story.
--
-- A grade é o feed. A função publicar-story lê os posts do perfil pela API,
-- escolhe um pela regra (melhor desempenho primeiro, sem repetir em 60 dias,
-- sem publicar se a equipe já postou story à mão no dia), publica a imagem
-- como story e, no dia seguinte, guarda as métricas. Esta tabela é o diário
-- de bordo: o que saiu, quando, com que resultado — e é o que impede a
-- repetição.
--
-- Pausar sem deploy: insert into app_config(chave, valor)
--   values ('stories_auto', '{"ativo": false}')
--   on conflict (chave) do update set valor = excluded.valor;

create table if not exists stories_auto (
  id              bigserial primary key,
  dia             date not null,                 -- dia da publicação (Brasília)
  media_id        text not null,                 -- post do feed que foi republicado
  permalink       text,
  legenda         text,                          -- começo da legenda do post, para a tela
  imagem_url      text,                          -- o que foi mandado para a API
  tipo_post       text,                          -- IMAGE / CAROUSEL_ALBUM / VIDEO
  autor           text,                          -- dono do post quando veio da lista de marcados (colab/fotógrafo); null = próprio
  score           numeric,                       -- curtidas + 3 × comentários na hora da escolha
  story_id        text,                          -- id do story publicado
  status          text not null default 'publicado'
                  check (status in ('publicado', 'erro', 'pulado', 'dry')),
  erro            text,
  metricas        jsonb,                         -- insights do story, coletados no dia seguinte
  metricas_em     timestamptz,
  publicado_em    timestamptz not null default now()
);

-- um story automático por dia; "pulado" e "dry" também ocupam o dia, para o
-- cron não publicar duas vezes se rodar de novo
create unique index if not exists stories_auto_dia_uq on stories_auto (dia)
  where status in ('publicado', 'pulado');
create index if not exists stories_auto_media_idx on stories_auto (media_id, dia desc);

alter table stories_auto enable row level security;
drop policy if exists stories_auto_admin on stories_auto;
create policy stories_auto_admin on stories_auto
  for all to authenticated
  using (get_my_role() = 'admin')
  with check (get_my_role() = 'admin');
revoke all on stories_auto from anon;
grant select, insert, update, delete on stories_auto to authenticated;

-- ── Autenticação do cron (mesmo desenho do follow-up) ─────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'stories_auto') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'stories_auto');
  end if;
end $$;

create or replace function public.stories_auto_auth(p_token text)
returns boolean language sql stable security definer
set search_path = public, vault as $f$
  select p_token is not null
     and length(p_token) > 20
     and exists (
       select 1 from vault.decrypted_secrets v
        where v.name = 'stories_auto' and v.decrypted_secret = p_token)
$f$;
revoke all on function public.stories_auto_auth(text) from public, anon, authenticated;
grant execute on function public.stories_auto_auth(text) to service_role;

-- Publica às 10h de Brasília (13h UTC) e colhe as métricas do story do dia
-- anterior às 10h30 — o story de ontem ainda está no ar até as 10h, e as
-- métricas ficam disponíveis por mais um tempo depois de expirar.
select cron.unschedule('stories-auto-publicar')
 where exists (select 1 from cron.job where jobname = 'stories-auto-publicar');
select cron.schedule('stories-auto-publicar', '0 13 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/publicar-story',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'stories_auto' limit 1)),
    body    := '{"acao":"publicar"}'::jsonb,
    timeout_milliseconds := 120000)   -- a lista de marcados leva ~35 s
$job$);

select cron.unschedule('stories-auto-metricas')
 where exists (select 1 from cron.job where jobname = 'stories-auto-metricas');
select cron.schedule('stories-auto-metricas', '30 13 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/publicar-story',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'stories_auto' limit 1)),
    body    := '{"acao":"metricas"}'::jsonb,
    timeout_milliseconds := 120000)   -- a lista de marcados leva ~35 s
$job$);

-- coluna acrescentada depois da primeira aplicação
alter table stories_auto add column if not exists autor text;
