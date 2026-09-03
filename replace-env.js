/**
 * replace-env.js
 *
 * Script ejecutado por Cloudflare Pages durante el build de producción.
 * Sustituye el placeholder __API_URL__ en environment.prod.ts por el valor
 * real de la variable de entorno API_URL configurada en el dashboard de CF Pages.
 *
 * Configuración en Cloudflare Pages → Settings → Build:
 *   Build command: node replace-env.js && npm run build:prod
 */

const fs   = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'environments', 'environment.prod.ts');
const apiUrl   = process.env['API_URL'];

if (!apiUrl) {
  console.error('[replace-env] ERROR: API_URL environment variable is not set.');
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');
content = content.replace('__API_URL__', apiUrl);
fs.writeFileSync(filePath, content, 'utf8');

console.log(`[replace-env] Replaced __API_URL__ with: ${apiUrl}`);
