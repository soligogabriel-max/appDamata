// Supabase Edge Function: upload-landing-pdf
// Aceita multipart/form-data (campo "file") ou JSON {file_b64, name, type, folder}.
// Usa service role key (auto-injetada) para salvar no bucket landing-pdfs.
// Requer JWT autenticado com papel admin ou equipe.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function getRole(jwt: string): string | null {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    return payload?.app_metadata?.role || payload?.user_metadata?.role || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!token || token === anonKey) return json({ error: "Não autorizado." }, 401);
  const role = getRole(token);
  if (!["admin", "equipe"].includes(role ?? "")) return json({ error: "Acesso restrito à equipe." }, 403);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let bytes: ArrayBuffer;
  let fileName: string;
  let contentType: string;
  let folder: string;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    let formData: FormData;
    try { formData = await req.formData(); } catch {
      return json({ error: "Esperado multipart/form-data." }, 400);
    }
    const file = formData.get("file");
    if (!(file instanceof File)) return json({ error: "Campo 'file' ausente ou inválido." }, 400);
    bytes = await file.arrayBuffer();
    fileName = file.name;
    contentType = file.type || "application/pdf";
    folder = (formData.get("folder") as string | null)?.replace(/[^a-zA-Z0-9_-]/g, "") || "";
  } else {
    let body: { file_b64?: string; name?: string; type?: string; folder?: string };
    try { body = await req.json(); } catch {
      return json({ error: "Esperado JSON {file_b64, name, type, folder}." }, 400);
    }
    if (!body.file_b64) return json({ error: "Campo 'file_b64' ausente." }, 400);
    try {
      const bin = atob(body.file_b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      bytes = arr.buffer;
    } catch {
      return json({ error: "Base64 inválido." }, 400);
    }
    fileName = body.name || "upload";
    contentType = body.type || "application/pdf";
    folder = (body.folder || "").replace(/[^a-zA-Z0-9_-]/g, "");
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = folder ? `${folder}/${Date.now()}_${safeName}` : `${Date.now()}_${safeName}`;

  const { error } = await supabase.storage
    .from("landing-pdfs")
    .upload(objectPath, bytes, { contentType, upsert: true });

  if (error) return json({ error: "Falha ao salvar no Storage.", detail: error.message }, 502);

  const { data: { publicUrl } } = supabase.storage
    .from("landing-pdfs")
    .getPublicUrl(objectPath);

  return json({ ok: true, url: publicUrl, name: fileName });
});
