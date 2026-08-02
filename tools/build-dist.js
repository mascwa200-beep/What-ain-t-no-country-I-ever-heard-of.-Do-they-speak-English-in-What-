// Build dist/PixelDeity.html — the entire game inlined into ONE file.
// Usage: node tools/build-dist.js [repoRoot]   (defaults to the repo root)
const fs = require('fs');
const path = require('path');
const base = process.argv[2] || path.join(__dirname, '..');

let html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(base, 'styles.css'), 'utf8');

// inline the stylesheet
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>');
// drop the manifest link + SW registration (single-file build runs from anywhere)
html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '');
html = html.replace(/<script>\s*\/\/ PWA[\s\S]*?<\/script>/, '');

// inline every game script in order
html = html.replace(/<script src="js\/([a-z0-9]+)\.js"><\/script>\n?/g, (m, name) => {
  const code = fs.readFileSync(path.join(base, 'js', name + '.js'), 'utf8');
  return '<script>\n' + code + '\n</script>\n';
});

if (/<script src=/.test(html)) throw new Error('unresolved script tag remains!');
if (/stylesheet/.test(html)) throw new Error('unresolved stylesheet remains!');

fs.mkdirSync(path.join(base, 'dist'), { recursive: true });
const out = path.join(base, 'dist', 'PixelDeity.html');
fs.writeFileSync(out, html);
console.log('built', out, (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
