const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8080";

console.log(`[smoke] health: ${base}/api/health`);

const health = await fetch(`${base}/api/health`, {
  signal: AbortSignal.timeout(10_000)
});

if (!health.ok) throw new Error(`health HTTP ${health.status}`);
console.log("[smoke] health OK", await health.json());

if (process.env.LIVE_NVIDIA_TEST === "1") {
  console.log("[smoke] iniciando inferência NVIDIA real (timeout: 90s)…");
  const started = Date.now();

  let response;

  try {
    response = await fetch(`${base}/api/interpret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(90_000),
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
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("TIMEOUT_NVIDIA: inferência excedeu 90 segundos");
    }
    throw error;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[smoke] NVIDIA respondeu em ${elapsed}s com HTTP ${response.status}`);

  const raw = await response.text();
  let body;

  try {
    body = JSON.parse(raw);
  } catch {
    body = { raw };
  }

  if (!response.ok) {
    throw new Error(
      `NVIDIA_HTTP_${response.status}: ${JSON.stringify(body).slice(0, 1200)}`
    );
  }

  const content = String(body.content || "");

  if (!content.trim()) {
    throw new Error("NVIDIA_EMPTY_RESPONSE");
  }

  console.log("[smoke] inferência OK");
  console.log(content.slice(0, 700));
} else {
  console.log("[smoke] LIVE_NVIDIA_TEST desativado; somente health check.");
}
