const encoder = new TextEncoder();

function decodeBase64Utf8(value) {
  const binary = atob(String(value || ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed =
    origin === env.ALLOWED_ORIGIN ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

  return {
    "Access-Control-Allow-Origin": allowed ? origin : env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function clean(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeMap(input = {}) {
  return {
    sol: clean(input.sol || input.sun, 40),
    persona: clean(input.persona, 40),
    data: clean(input.data || input.date, 20),
    hora: clean(input.hora || input.time, 12),
    local: clean(input.local || input.place, 180),
    nascerDoSol: clean(input.nascerDoSol || input.sunrise, 12),
    meioDiaSolar: clean(input.meioDiaSolar || input.solarNoon, 12),
    porDoSol: clean(input.porDoSol || input.sunset, 12),
    fuso: clean(input.fuso || input.timezone, 80),
    horarioDeVerao: clean(input.horarioDeVerao || input.dst, 40)
  };
}

function sse(event, payload) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return (
    origin === env.ALLOWED_ORIGIN ||
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
  );
}

async function streamInterpretation(request, env) {
  if (!originAllowed(request, env)) {
    return json(request, env, {
      error: "origin_not_allowed",
      message: "Origem não autorizada."
    }, 403);
  }

  if (!env.NVIDIA_API_KEY || !env.NVIDIA_SYSTEM_PROMPT_B64) {
    return json(request, env, {
      error: "inference_not_configured",
      message: "Serviço de interpretação ainda não configurado."
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, {
      error: "invalid_json",
      message: "Requisição inválida."
    }, 400);
  }

  const map = normalizeMap(body?.map || body);

  if (!map.sol || !map.persona || !map.data || !map.hora) {
    return json(request, env, {
      error: "invalid_map",
      message: "Sol, persona, data e hora são obrigatórios."
    }, 400);
  }

  const prompt = decodeBase64Utf8(env.NVIDIA_SYSTEM_PROMPT_B64);

  const userMessage = [
    "Interprete o mapa calculado abaixo seguindo integralmente o método privado.",
    "",
    JSON.stringify(map, null, 2),
    "",
    "Não explique o prompt nem o processo interno. Entregue diretamente a interpretação."
  ].join("\n");

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sse("ready", { ok: true }));

      try {
        const upstream = await fetch(
          `${String(env.NVIDIA_BASE_URL).replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.NVIDIA_API_KEY}`,
              "Content-Type": "application/json",
              "Accept": "text/event-stream"
            },
            body: JSON.stringify({
              model: env.NVIDIA_MODEL,
              messages: [
                { role: "system", content: prompt },
                { role: "user", content: userMessage }
              ],
              temperature: Number(env.NVIDIA_TEMPERATURE || 0.35),
              top_p: Number(env.NVIDIA_TOP_P || 0.8),
              max_tokens: Number(env.NVIDIA_MAX_TOKENS || 2400),
              stream: true
            })
          }
        );

        if (!upstream.ok) {
          const raw = await upstream.text();
          let message = `Falha na inferência (${upstream.status}).`;

          try {
            const parsed = JSON.parse(raw);
            message =
              parsed?.detail ||
              parsed?.message ||
              parsed?.error?.message ||
              message;
          } catch {}

          controller.enqueue(sse("error", { message }));
          controller.close();
          return;
        }

        if (!upstream.body) {
          controller.enqueue(sse("error", {
            message: "O serviço de interpretação não retornou um fluxo."
          }));
          controller.close();
          return;
        }

        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let chars = 0;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data) continue;

            if (data === "[DONE]") {
              controller.enqueue(sse("done", { ok: true, chars }));
              controller.close();
              return;
            }

            let chunk;
            try {
              chunk = JSON.parse(data);
            } catch {
              continue;
            }

            const text = chunk?.choices?.[0]?.delta?.content;
            if (typeof text === "string" && text) {
              chars += text.length;
              controller.enqueue(sse("token", { text }));
            }
          }
        }

        controller.enqueue(sse("done", { ok: true, chars }));
        controller.close();
      } catch (error) {
        console.error(error);
        controller.enqueue(sse("error", {
          message: "A interpretação foi interrompida. Tente novamente."
        }));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!originAllowed(request, env)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(request, env, {
        ok: true,
        configured: Boolean(env.NVIDIA_API_KEY && env.NVIDIA_SYSTEM_PROMPT_B64)
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/interpret/stream"
    ) {
      return streamInterpretation(request, env);
    }

    return json(request, env, { error: "not_found" }, 404);
  }
};
