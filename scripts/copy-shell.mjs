/**
 * Copy the built shell artifacts (exe + WebView2Loader.dll) into the
 * plugin's shell/ directory, from which the npm package ships them.
 *
 * The DLL is REQUIRED at runtime — dsh-desktop.exe links WebView2Loader.dll
 * dynamically, and Windows looks for it next to the exe. Copying the exe
 * alone makes double-clicking the shortcut fail with "file not found".
 *
 * Usage: node scripts/copy-shell.mjs
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = join(REPO_ROOT, 'apps', 'shell', 'src-tauri', 'target', 'release')
const SHELL_DIR = join(REPO_ROOT, 'packages', 'dsh-desktop', 'shell')

const REQUIRED = ['dsh-desktop.exe', 'WebView2Loader.dll']

await mkdir(SHELL_DIR, { recursive: true })
const releaseFiles = await readdir(RELEASE_DIR)
let copied = 0
for (const name of REQUIRED) {
  if (!releaseFiles.includes(name)) {
    console.error(`MISSING in release dir: ${name} — build the shell first (cargo build --release)`)
    process.exit(1)
  }
  await copyFile(join(RELEASE_DIR, name), join(SHELL_DIR, name))
  console.log(`OK   ${name}`)
  copied++
}
console.log(`\ncopied ${copied} files to ${SHELL_DIR}`)
