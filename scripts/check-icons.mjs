// Live check: listIcons() must reflect the actual built-in icon directory.
process.env.DSH_HOME = 'D:\\dsh-home'
const { listIcons } = await import('file:///D:/dsh-home/dsh-desktop/packages/dsh-desktop/lib/index.mjs')
const icons = await listIcons()
console.log('=== listIcons() live result ===')
for (const icon of icons) {
  console.log(`${icon.id.padEnd(20)} ${icon.builtin ? 'builtin' : 'custom'}  ${icon.path}`)
}
const missing = icons.length === 0 ? 'NONE' : icons.map(i => i.name).join(', ')
console.log(`\nfound ${icons.length} icons: ${missing}`)
