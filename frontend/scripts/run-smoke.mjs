// 用 esbuild 的 JS API 打包并执行巡检分册冒烟测试，避免依赖各平台的 esbuild 可执行文件。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outfile = resolve(here, '.smoke-patrol.mjs')
const srcDir = resolve(here, '../src')

await build({
  entryPoints: [resolve(here, 'smoke-patrol.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { '@': srcDir },
})

try {
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(outfile, { force: true })
}
