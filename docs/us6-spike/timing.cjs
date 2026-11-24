const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const S = process.argv[2]; const NM = S + '/node_modules';
const map = [['/tjs/', NM + '/@huggingface/transformers/dist/'], ['/ort/', NM + '/onnxruntime-web/dist/'], ['/ortc/', NM + '/onnxruntime-common/dist/esm/'], ['/models/', S + '/models/'], ['/', S + '/web/']];
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const [p, d] = map.find(([p]) => u.startsWith(p)); let f = path.join(d, u.slice(p.length) || 'index.html'); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=3600' }); fs.createReadStream(f).pipe(r); });
srv.listen(0, async () => {
  const base = `http://localhost:${srv.address().port}/`;
  const b = await chromium.launch();
  for (const [label, rate] of [['desktop (no throttle)', 1], ['mid-range phone (4x slower CPU)', 4], ['low-end phone (6x slower CPU)', 6]]) {
    for (const id of ['Xenova/all-MiniLM-L6-v2', 'Xenova/gte-small']) {
      const ctx = await b.newContext(); const p = await ctx.newPage();
      const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      p.on('pageerror', (e) => console.log('ERR', e.message));
      await p.goto(base); await p.waitForFunction(() => window.ready);
      const cold = await p.evaluate((m) => window.run(m), id);
      await p.reload(); await p.waitForFunction(() => window.ready);
      const warm = await p.evaluate((m) => window.run(m), id); // files now in browser cache
      console.log(`${label.padEnd(33)} ${id.split('/')[1].padEnd(18)} first: start ${cold.loadInit} ms · later visits: start ${warm.loadInit} ms · 8 resume lines ${warm.resume8} ms · 20 requirements ${warm.reqs20} ms`);
      await ctx.close();
    }
  }
  await b.close(); srv.close();
});
