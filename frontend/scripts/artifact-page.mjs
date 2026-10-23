// Turns the single-file Vite build into a claude.ai artifact page: the platform wraps the
// page in its own <html>/<head>/<body>, so only title, font link, style, root and script remain.
import { readFileSync, writeFileSync } from 'node:fs'

const html = readFileSync('dist-artifact/index.html', 'utf8')
const pick = (re, name) => {
  const m = html.match(re)
  if (!m) throw new Error(`artifact-page: ${name} not found in build output`)
  return m[0]
}
const title = pick(/<title>[\s\S]*?<\/title>/, 'title')
const fonts = [...html.matchAll(/<link[^>]+fonts\.googleapis\.com[^>]*>/g)].map((m) => m[0])
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0])
const scripts = [...html.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0])
if (!styles.length || !scripts.length) throw new Error('artifact-page: style or script missing')

const page = [title, ...fonts, ...styles, '<div id="root"></div>', ...scripts].join('\n')
writeFileSync('dist-artifact/early-bird.html', page)
console.log(`dist-artifact/early-bird.html: ${(page.length / 1024 / 1024).toFixed(2)} MB`)
