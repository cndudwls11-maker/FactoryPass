import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { origin, pages } from '../site.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  out = resolve(root, 'dist');
if (dirname(out) !== root || basename(out) !== 'dist')
  throw new Error('Invalid build output path');
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
const source = await readFile(join(root, 'app.js'), 'utf8');
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const logo = source.slice(
  source.indexOf('function logo()'),
  source.indexOf('function safeVerifyReturn('),
);
const landing = source.slice(
  source.indexOf('function landing()'),
  source.indexOf('function authPage('),
);
if (!logo || !landing) throw new Error('Landing renderer was not found');
const sandbox = { app: { innerHTML: '' }, $: () => ({}), Date };
vm.runInNewContext(logo + '\n' + landing + '\nlanding();', sandbox, {
  timeout: 1000,
});
let template = await readFile(join(root, 'index.html'), 'utf8');
const config = JSON.parse(
  await readFile(join(root, 'tracking.config.json'), 'utf8'),
);
const ids = {
  measurementId: process.env.GA_MEASUREMENT_ID || config.measurementId || '',
  containerId: process.env.GTM_CONTAINER_ID || config.containerId || '',
};
if (ids.measurementId && !/^G-[A-Z0-9]+$/.test(ids.measurementId))
  throw new Error('Invalid GA4 measurement ID');
if (ids.containerId && !/^GTM-[A-Z0-9]+$/.test(ids.containerId))
  throw new Error('Invalid GTM container ID');
for (const file of [
  'app.js',
  'ui.js',
  'lists.js',
  'analytics.js',
  'boot.js',
  'tracking-config.js',
  'styles.css',
]) {
  const content =
    file === 'tracking-config.js'
      ? `window.FACTORYPASS_TRACKING=${JSON.stringify(ids)};`
      : await readFile(join(root, file), 'utf8');
  const { code } = await transform(content, {
    loader: file.endsWith('.css') ? 'css' : 'js',
    minify: true,
    target: 'es2020',
  });
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 12),
    name = `${basename(file).replace(/\.(js|css)$/, '')}.${hash}.${file.endsWith('.css') ? 'css' : 'js'}`;
  await writeFile(join(out, 'assets', name), code);
  template = template.replaceAll('/' + file, '/assets/' + name);
}
await cp(join(root, 'assets'), join(out, 'assets'), { recursive: true });
for (const [path, [title, description]] of Object.entries(pages)) {
  const indexable = path === '/',
    url = origin + (path === '/' ? '/' : path),
    image = origin + '/assets/social/factorypass.png';
  const websiteSchema =
    path === '/'
      ? '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"FactoryPass","url":"https://factorypass.pages.dev/"}</script>'
      : '';
  const meta = `<link rel="canonical" href="${url}">
<meta name="robots" content="${indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow'}">
<meta property="og:type" content="website"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="FactoryPass">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="FactoryPass QR 출퇴근·스마트 근태관리">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${image}">
${websiteSchema}`;
  let html = template
    .replace(/<title>.*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${esc(description)}">`,
    )
    .replace('<!-- page-meta -->', meta);
  if (indexable)
    html = html.replace(
      /<!-- app-content -->[\s\S]*?<!-- \/app-content -->/,
      sandbox.app.innerHTML,
    );
  const target =
    path === '/' ? join(out, 'index.html') : join(out, path.slice(1) + '.html');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, html);
}
const error = template
  .replace(
    /<title>.*?<\/title>/,
    '<title>페이지를 찾을 수 없습니다 | FactoryPass</title>',
  )
  .replace(
    '<!-- page-meta -->',
    '<meta name="robots" content="noindex"><meta property="og:site_name" content="FactoryPass">',
  )
  .replace(
    /<!-- app-content -->[\s\S]*?<!-- \/app-content -->/,
    '<main class="auth-main"><section class="auth-box"><h1>페이지를 찾을 수 없습니다.</h1><a href="/" class="btn btn-primary">홈으로 이동</a></section></main>',
  )
  .replace(/\s*<script[^>]*><\/script>/g, '');
await writeFile(join(out, '404.html'), error);
for (const file of [
  'robots.txt',
  'sitemap.xml',
  '_routes.json',
  '_headers',
  'googleecfd9991f4e311d4.html',
])
  await cp(join(root, file), join(out, file));
console.log(
  `Built ${Object.keys(pages).length} pages with metadata and a prerendered homepage. Tracking: ${ids.containerId ? 'GTM' : ids.measurementId ? 'GA4' : 'not configured'}`,
);
