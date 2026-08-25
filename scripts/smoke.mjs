const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8080";

const health = await fetch(`${base}/api/health`);
if (!health.ok) throw new Error(`health HTTP ${health.status}`);
console.log(await health.json());

if (process.env.LIVE_NVIDIA_TEST === "1") {
  const response = await fetch(`${base}/api/interpret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  console.log(String(body.content || "").slice(0, 500));
}
