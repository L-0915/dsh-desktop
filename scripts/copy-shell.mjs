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
import { access, copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE_DIR = join(REPO_ROOT, 'apps', 'shell', 'src-tauri', 'target', 'release')
const SHELL_DIR = join(REPO_ROOT, 'packages', 'dsh-desktop', 'shell')

const REQUIRED = ['dsh-desktop.exe', 'WebView2Loader.dll']

/**
 * Locate WebView2Loader.dll. Cargo builds it into the webview2-com-sys
 * build output (target/<profile>/build/webview2-com-sys-* /out/x64/), not
 * the profile root — a plain `cargo build --release` on CI therefore leaves
 * target/release/WebView2Loader.dll missing. Prefer the profile root (e.g.
 * a previous manual copy), then fall back to the build output.
 */
async function findWebView2Loader() {
  const direct = join(RELEASE_DIR, 'WebView2Loader.dll')
  try {
    await access(direct)
    return direct
  } catch {}
  const buildDir = join(RELEASE_DIR, 'build')
  let entries = []
  try {
    entries = await readdir(buildDir)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.startsWith('webview2-com-sys-')) continue
    const candidate = join(buildDir, entry, 'out', 'x64', 'WebView2Loader.dll')
    try {
      await access(candidate)
      return candidate
    } catch {}
  }
  return null
}

await mkdir(SHELL_DIR, { recursive: true })
const releaseFiles = await readdir(RELEASE_DIR)
let copied = 0
for (const name of REQUIRED) {
  let source = join(RELEASE_DIR, name)
  if (!releaseFiles.includes(name)) {
    if (name === 'WebView2Loader.dll') {
      const found = await findWebView2Loader()
      if (found) {
        console.log(`DBG  ${name}: copied from build output ${found}`)
        source = found
      } else {
        console.error(`MISSING in release dir: ${name} — build the shell first (cargo build --release)`)
        process.exit(1)
      }
    } else {
      console.error(`MISSING in release dir: ${name} — build the shell first (cargo build --release)`)
      process.exit(1)
    }
  }
  await copyFile(source, join(SHELL_DIR, name))
  if (name === 'WebView2Loader.dll' && source !== join(RELEASE_DIR, name)) {
    // CI uploads from target/release — also drop a copy there so the
    // artifact step picks it up alongside the exe.
    await copyFile(source, join(RELEASE_DIR, name))
  }
  console.log(`OK   ${name}`)
  copied++
}
console.log(`\ncopied ${copied} files to ${SHELL_DIR}`)
