// Supabase Edge Function: upload-landing-pdf
// Receives multipart/form-data with field "file" (PDF) + optional "name".
// Uploads to Storage bucket "landing-pdfs" and returns public URL.
//
// Secrets required:
//   SUPABASE_URL            = project URL (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY = service role key (set in Edge Function secrets)

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json({ error: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios." }, 500);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Esperado multipart/form-data." }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return json({ error: "Campo 'file' ausente ou inválido." }, 400);

  const customName = (formData.get("name") as string | null)?.trim();
  const safeName   = customName || file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp  = Date.now();
  const objectPath = `${timestamp}_${safeName}`;

  const bytes = await file.arrayBuffer();

  const storageRes = await fetch(
    `${supabaseUrl}/storage/v1/object/landing-pdfs/${objectPath}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": file.type || "application/pdf",
        "x-upsert": "true",
      },
      body: bytes,
    }
  );

  if (!storageRes.ok) {
    const err = await storageRes.text();
    return json({ error: "Falha ao salvar no Storage.", detail: err }, 502);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/landing-pdfs/${objectPath}`;
  return json({ ok: true, url: publicUrl, name: safeName });
});
