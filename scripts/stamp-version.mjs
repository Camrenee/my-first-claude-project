// Stamp a release version onto every CSS and JS URL in index.html so browsers never mix
// an old cached file with a new one after an update.
//
// JS modules import each other by plain paths ("./store.js"); an import map in index.html
// redirects each of those to "js/store.js?v=<version>". Run after changing any css/ or js/ file:
//   node scripts/stamp-version.mjs            (version = current time)
//   node scripts/stamp-version.mjs 2026.11.22 (explicit version)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const version = process.argv[2] ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const file = path.join(ROOT, 'index.html');
let html = fs.readFileSync(file, 'utf8');

const modules = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).sort();
const map = { imports: Object.fromEntries(modules.map((m) => [`./js/${m}`, `./js/${m}?v=${version}`])) };
const mapTag = `<script type="importmap">${JSON.stringify(map)}</script>`;

// Replace (or insert) the import map just before the app's module script.
html = html.replace(/\s*<script type="importmap">.*?<\/script>/s, '');
html = html.replace(/(\n\s*)<script type="module" src="js\/app\.js(\?v=[^"]*)?"><\/script>/, `$1${mapTag}$1<script type="module" src="js/app.js?v=${version}"></script>`);
html = html.replace(/href="css\/(tokens|app)\.css(\?v=[^"]*)?"/g, `href="css/$1.css?v=${version}"`);

fs.writeFileSync(file, html);
console.log(`Stamped version ${version} on ${modules.length} modules and 2 stylesheets.`);
