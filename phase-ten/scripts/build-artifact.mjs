// Builds the single-file Claude artifact from the shared engine, UI and styles.
// Usage: node scripts/build-artifact.mjs  ->  dist/phase-ten-artifact.html
import { readFile, writeFile, mkdir } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const stripModule = (src) =>
  src
    .replace(/^import .*;\n/gm, "")
    .replace(/^export (?=(const|function|class) )/gm, "");

const [engine, bot, ui, transport, css] = await Promise.all([
  read("public/engine.js"),
  read("public/bot.js"),
  read("public/ui.js"),
  read("artifact/transport.js"),
  read("public/styles.css"),
]);

const html = `<title>Phase Ten</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Rubik:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${css}
</style>
<div id="app"></div>
<script>
(() => {
${stripModule(engine)}
${stripModule(bot)}
${stripModule(ui)}
${transport}
mountApp(document.getElementById("app"), createArtifactTransport());
})();
</script>
`;

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
const out = new URL("../dist/phase-ten-artifact.html", import.meta.url);
await writeFile(out, html);
console.log(`Wrote ${out.pathname} (${(html.length / 1024).toFixed(1)} KB)`);
