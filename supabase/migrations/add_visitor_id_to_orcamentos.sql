-- Adiciona visitor_id em orcamentos para rastrear qual visitante do site orçamentou
-- visitor_id = localStorage 'dmv_sid' gravado pelo script de rastreamento em index.html
-- Isso permite cruzar site_visits.session_id com orcamentos.visitor_id

ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS visitor_id text;

-- Índice para facilitar contagem de visitantes únicos que orçamentaram
CREATE INDEX IF NOT EXISTS idx_orcamentos_visitor_id ON orcamentos(visitor_id);
