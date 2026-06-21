-- Adiciona coluna para armazenar o ID do evento no Google Calendar
-- Execute no SQL Editor do Supabase Dashboard
ALTER TABLE agenda ADD COLUMN IF NOT EXISTS google_cal_id TEXT;
