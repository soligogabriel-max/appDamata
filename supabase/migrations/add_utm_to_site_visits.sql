-- Adiciona colunas UTM em site_visits para rastrear origem dos acessos
-- Permite distinguir WhatsApp, Instagram Ads, Google, etc.

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content  text,
  ADD COLUMN IF NOT EXISTS utm_term     text;

CREATE INDEX IF NOT EXISTS idx_site_visits_utm_source ON site_visits(utm_source);
