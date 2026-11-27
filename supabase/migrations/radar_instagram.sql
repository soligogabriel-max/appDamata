-- Radar do Instagram: o que saiu da curva nos perfis que a equipe acompanha.
--
-- A API não entrega a lista de quem a conta segue, então os perfis são
-- cadastrados à mão. Todo dia a função radar-instagram lê os últimos posts
-- públicos de cada um (business discovery, só conta profissional), compara
-- cada post da última semana com a mediana do perfil e, quando um sai da
-- curva, avisa a equipe no WhatsApp com o link. O repost é pelo app, com o
-- sticker e o crédito — pela API iria a imagem solta, sem crédito.

create table if not exists radar_perfis (
  username     text primary key,                 -- sem @, minúsculo
  tipo         text not null default 'referencia' check (tipo in ('referencia', 'parceiro')),
  ativo        boolean not null default true,
  seguidores   integer,
  ultima_leitura timestamptz,
  ultimo_erro  text,
  criado_em    timestamptz not null default now()
);

create table if not exists radar_posts (
  media_id     text primary key,
  username     text not null references radar_perfis(username) on delete cascade,
  permalink    text,
  media_type   text,
  imagem_url   text,
  legenda      text,
  publicado_em timestamptz not null,
  curtidas     integer not null default 0,
  comentarios  integer not null default 0,
  engajamento  integer not null default 0,        -- curtidas + 3 × comentários
  mediana      integer,                           -- mediana do perfil na hora da leitura
  razao        numeric(6,2),                      -- engajamento / mediana
  viral        boolean not null default false,
  avisado_em   timestamptz,
  lido_em      timestamptz not null default now()
);
create index if not exists radar_posts_viral_idx on radar_posts (viral, publicado_em desc);
create index if not exists radar_posts_perfil_idx on radar_posts (username, publicado_em desc);

alter table radar_perfis enable row level security;
alter table radar_posts  enable row level security;
drop policy if exists radar_perfis_admin on radar_perfis;
create policy radar_perfis_admin on radar_perfis for all to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');
drop policy if exists radar_posts_admin on radar_posts;
create policy radar_posts_admin on radar_posts for all to authenticated
  using (get_my_role() = 'admin') with check (get_my_role() = 'admin');
revoke all on radar_perfis, radar_posts from anon;
grant select, insert, update, delete on radar_perfis, radar_posts to authenticated;

-- ── Autenticação do cron ──
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'radar_instagram') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'radar_instagram');
  end if;
end $$;

create or replace function public.radar_instagram_auth(p_token text)
returns boolean language sql stable security definer
set search_path = public, vault as $f$
  select p_token is not null
     and length(p_token) > 20
     and exists (
       select 1 from vault.decrypted_secrets v
        where v.name = 'radar_instagram' and v.decrypted_secret = p_token)
$f$;
revoke all on function public.radar_instagram_auth(text) from public, anon, authenticated;
grant execute on function public.radar_instagram_auth(text) to service_role;

-- 9h15 de Brasília: antes do story das 10h e fora da hora cheia.
select cron.unschedule('radar-instagram-diario')
 where exists (select 1 from cron.job where jobname = 'radar-instagram-diario');
select cron.schedule('radar-instagram-diario', '15 12 * * *', $job$
  select net.http_post(
    url     := 'https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/radar-instagram',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'radar_instagram' limit 1)),
    body    := '{"acao":"varrer"}'::jsonb,
    timeout_milliseconds := 120000)
$job$);
