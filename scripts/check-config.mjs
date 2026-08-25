import fs from "node:fs";

for (const file of [
  "index.html",
  "server.mjs",
  ".env.example",
  "private/prompt-mestre-privado.md"
]) {
  if (!fs.existsSync(file)) {
    console.error(`Ausente: ${file}`);
    process.exit(1);
  }
}

const html = fs.readFileSync("index.html", "utf8");
if (/nvapi-[A-Za-z0-9_-]+/.test(html)) {
  console.error("ERRO: possível chave NVIDIA encontrada no index.html.");
  process.exit(1);
}

console.log("Configuração estrutural OK.");
