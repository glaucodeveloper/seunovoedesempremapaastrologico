const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8080";

console.log(`[smoke] health: ${base}/api/health`);

const health = await fetch(`${base}/api/health`, {
  signal: AbortSignal.timeout(10_000)
});

if (!health.ok) throw new Error(`health HTTP ${health.status}`);
console.log("[smoke] health OK", await health.json());

if (process.env.LIVE_NVIDIA_TEST !== "1") {
  console.log("[smoke] teste real desativado.");
  process.exit(0);
}

console.log("[smoke] abrindo stream de inferência…");

const controller = new AbortController();
const started = performance.now();

const firstTokenTimeout = setTimeout(() => {
  controller.abort(new Error("FIRST_TOKEN_TIMEOUT"));
}, 180_000);

try {
  const response = await fetch(`${base}/api/interpret/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "text/event-stream"
    },
    signal: controller.signal,
    body: JSON.stringify({
      map: {
        sol: "Sagitário",
        persona: "Libra",
        data: "21/05/1996",
        hora: "17:18",
        local: "Vitória da Conquista, BA, Brasil",
        meioDiaSolar: "11:47"
      }
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`stream HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let chars = 0;
  let firstTokenAt = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "";
      let data = "";

      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }

      if (!data) continue;

      let payload;
      try { payload = JSON.parse(data); }
      catch { continue; }

      if (event === "token" && typeof payload.text === "string") {
        if (firstTokenAt === null) {
          firstTokenAt = performance.now();
          const ttfb = ((firstTokenAt - started) / 1000).toFixed(2);
          console.log(`[smoke] primeiro token em ${ttfb}s`);
        }

        chars += payload.text.length;

        if (chars >= 160) {
          console.log(`[smoke] streaming OK (${chars} caracteres)`);
          controller.abort();
          process.exit(0);
        }
      }

      if (event === "error") {
        throw new Error(payload.message || "stream error");
      }

      if (event === "done") {
        if (!chars) throw new Error("stream terminou sem tokens");
        console.log(`[smoke] streaming concluído (${chars} caracteres)`);
        process.exit(0);
      }
    }
  }

  if (!chars) throw new Error("stream terminou sem conteúdo");
} finally {
  clearTimeout(firstTokenTimeout);
}
