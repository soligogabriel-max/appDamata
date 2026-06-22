-- Adiciona coluna status na tabela agenda
-- Valores: proposta | confirmado | cancelado
ALTER TABLE agenda
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'proposta'
  CHECK (status IN ('proposta','confirmado','cancelado'));
