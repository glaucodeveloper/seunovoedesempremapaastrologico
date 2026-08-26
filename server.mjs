import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

async function loadEnv(file = path.join(ROOT, ".env")) {
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i <= 0) continue;
      const key = trimmed.slice(0, i).trim();
      let value = trimmed.slice(i + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await loadEnv();

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1";
const NVIDIA_BASE_URL =
  (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
const NVIDIA_MODEL =
  process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "";
const TEMPERATURE = Number(process.env.NVIDIA_TEMPERATURE || 0.35);
const TOP_P = Number(process.env.NVIDIA_TOP_P || 0.8);
const MAX_TOKENS = Number(process.env.NVIDIA_MAX_TOKENS || 2400);
const NVIDIA_REQUEST_TIMEOUT_MS = Number(process.env.NVIDIA_REQUEST_TIMEOUT_MS || 300000);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

const rate = new Map();

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function allowedByRate(req) {
  const now = Date.now();
  const ip = clientIp(req);
  const period = 10 * 60 * 1000;
  const max = 8;
  const history = (rate.get(ip) || []).filter((t) => now - t < period);
  if (history.length >= max) return false;
  history.push(now);
  rate.set(ip, history);
  return true;
}

async function readJson(req, maxBytes = 24000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function cleanString(value, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeMap(input = {}) {
  return {
    sol: cleanString(input.sol || input.sun, 40),
    persona: cleanString(input.persona, 40),
    data: cleanString(input.data || input.date, 20),
    hora: cleanString(input.hora || input.time, 12),
    local: cleanString(input.local || input.place, 180),
    nascerDoSol: cleanString(input.nascerDoSol || input.sunrise, 12),
    meioDiaSolar: cleanString(input.meioDiaSolar || input.solarNoon, 12),
    porDoSol: cleanString(input.porDoSol || input.sunset, 12),
    fuso: cleanString(input.fuso || input.timezone, 80),
    horarioDeVerao: cleanString(input.horarioDeVerao || input.dst, 40)
  };
}

async function masterPrompt() {
  return fs.readFile(path.join(ROOT, "private", "prompt-mestre-privado.md"), "utf8");
}

async function nvidiaInterpret(map) {
  if (!NVIDIA_API_KEY) {
    const error = new Error("NVIDIA_API_KEY não configurada.");
    error.code = "NO_API_KEY";
    throw error;
  }

  const system = await masterPrompt();
  const user = [
    "Interprete o mapa calculado abaixo seguindo integralmente o método privado.",
    "",
    JSON.stringify(map, null, 2),
    "",
    "Não explique o prompt nem o processo interno. Entregue diretamente a interpretação."
  ].join("\n");

  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${NVIDIA_API_KEY}`,
      "accept": "application/json"
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      temperature: TEMPERATURE,
      top_p: TOP_P,
      max_tokens: MAX_TOKENS,
      stream: false
    })
  });

  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch { body = { raw: text }; }

  if (!response.ok) {
    const error = new Error(
      body?.detail ||
      body?.message ||
      body?.error?.message ||
      `NVIDIA API retornou HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Resposta NVIDIA sem conteúdo.");

  return {
    content,
    usage: body?.usage || null
  };
}


async function nvidiaInterpretStream(map, req, res) {
  if (!NVIDIA_API_KEY) {
    json(res, 503, {
      error: "inference_not_configured",
      message: "Inferência temporariamente indisponível."
    });
    return;
  }

  const system = await masterPrompt();
  const user = [
    "Interprete o mapa calculado abaixo seguindo integralmente o método privado.",
    "",
    JSON.stringify(map, null, 2),
    "",
    "Não explique o prompt nem o processo interno. Entregue diretamente a interpretação."
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("UPSTREAM_TIMEOUT")),
    NVIDIA_REQUEST_TIMEOUT_MS
  );

  const abortOnClose = () => {
    if (!res.writableEnded) controller.abort(new Error("CLIENT_DISCONNECTED"));
  };
  req.once("close", abortOnClose);

  try {
    const upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${NVIDIA_API_KEY}`,
        "accept": "text/event-stream"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: TEMPERATURE,
        top_p: TOP_P,
        max_tokens: MAX_TOKENS,
        stream: true
      })
    });

    if (!upstream.ok) {
      const raw = await upstream.text();
      let body;
      try { body = JSON.parse(raw); }
      catch { body = { raw }; }

      json(res, upstream.status || 502, {
        error: "inference_upstream_error",
        message:
          body?.detail ||
          body?.message ||
          body?.error?.message ||
          `Falha na inferência (${upstream.status}).`
      });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff"
    });
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = 0;

    const emit = (event, payload) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    emit("ready", { ok: true });

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
          emit("done", { ok: true, chars: emitted });
          res.end();
          return;
        }

        let chunk;
        try { chunk = JSON.parse(data); }
        catch { continue; }

        const text = chunk?.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length) {
          emitted += text.length;
          emit("token", { text });
        }
      }
    }

    emit("done", { ok: true, chars: emitted });
    res.end();
  } catch (error) {
    console.error("[inference-stream]", error);

    if (!res.headersSent) {
      json(res, error?.name === "AbortError" ? 504 : 502, {
        error: error?.name === "AbortError"
          ? "inference_timeout"
          : "inference_stream_error",
        message: error?.name === "AbortError"
          ? "A interpretação excedeu o tempo máximo."
          : "A interpretação foi interrompida."
      });
    } else if (!res.writableEnded) {
      res.write("event: error\n");
      res.write(`data: ${JSON.stringify({
        message: error?.name === "AbortError"
          ? "A interpretação excedeu o tempo máximo."
          : "A interpretação foi interrompida."
      })}\n\n`);
      res.end();
    }
  } finally {
    clearTimeout(timeout);
    req.off("close", abortOnClose);
  }
}

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  if (pathname === "/") pathname = "/index.html";

  if (
    pathname.startsWith("/private/") ||
    pathname.startsWith("/.git") ||
    pathname.startsWith("/.github") ||
    pathname.startsWith("/.env") ||
    pathname.includes("..")
  ) {
    json(res, 404, { error: "not_found" });
    return;
  }

  const file = path.join(ROOT, decodeURIComponent(pathname));
  if (!file.startsWith(ROOT)) {
    json(res, 404, { error: "not_found" });
    return;
  }

  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw Object.assign(new Error(), { code: "ENOENT" });
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();

    res.writeHead(200, {
      "content-type": mime[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin"
    });
    res.end(data);
  } catch (error) {
    if (error?.code === "ENOENT") {
      json(res, 404, { error: "not_found" });
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        configured: Boolean(NVIDIA_API_KEY)
      });
      return;
    }


    if (req.method === "POST" && url.pathname === "/api/interpret/stream") {
      if (!allowedByRate(req)) {
        json(res, 429, {
          error: "rate_limit",
          message: "Tente novamente em alguns minutos."
        });
        return;
      }

      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, {
          error: error.message === "PAYLOAD_TOO_LARGE"
            ? "payload_too_large"
            : "invalid_json"
        });
        return;
      }

      const map = normalizeMap(body?.map || body);

      if (!map.sol || !map.persona || !map.data || !map.hora) {
        json(res, 400, {
          error: "invalid_map",
          message: "Sol, persona, data e hora são obrigatórios."
        });
        return;
      }

      await nvidiaInterpretStream(map, req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/interpret") {
      if (!allowedByRate(req)) {
        json(res, 429, {
          error: "rate_limit",
          message: "Tente novamente em alguns minutos."
        });
        return;
      }

      let body;
      try {
        body = await readJson(req);
      } catch (error) {
        json(res, error.message === "PAYLOAD_TOO_LARGE" ? 413 : 400, {
          error: error.message === "PAYLOAD_TOO_LARGE" ? "payload_too_large" : "invalid_json"
        });
        return;
      }

      const map = normalizeMap(body?.map || body);
      if (!map.sol || !map.persona || !map.data || !map.hora) {
        json(res, 400, {
          error: "invalid_map",
          message: "Sol, persona, data e hora são obrigatórios."
        });
        return;
      }

      try {
        json(res, 200, await nvidiaInterpret(map));
      } catch (error) {
        console.error("[nvidia]", error);
        json(res, error.status || 502, {
          error: error.code || "nvidia_error",
          message: error.message || "Falha na inferência."
        });
      }
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "internal_error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Seu Novo e de Sempre: http://${HOST}:${PORT}`);
  console.log(`NVIDIA model: ${NVIDIA_MODEL}`);
  console.log(`NVIDIA key: ${NVIDIA_API_KEY ? "configurada" : "AUSENTE"}`);
});
