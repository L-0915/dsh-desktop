import { defineConfig } from 'tsdown'

const ID = '@debb74/dsh-desktop'

// shell 注入到冻结模块表的平台模块，客户端 bundle 必须 external，
// 由 factory 的 require 在运行时从模块表解析。
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const CLIENT_EXTERNALS = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

/**
 * Node half (host process): shortcut/icon/config API, plain ESM.
 * Every runtime dependency stays external — the host web profile supplies
 * @deepseek-ai/* and peer packages; bundling them would create duplicate
 * cordis service instances.
 */
const node = {
  name: ID,
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  outDir: 'lib',
  dts: false,
  clean: false,
  platform: 'node',
  target: 'node22',
  deps: {
    neverBundle: [
      /^@deepseek-ai\//,
      /^schemastery$/,
      /^cosmokit$/,
      /^react$/,
      /^react-dom$/,
    ],
  },
}

/**
 * Browser half: CJS closure-factory bundle that self-registers via
 * window.__ModuleLoader__.load({ id, factory }); the shell fetches it as a
 * classic script and materializes the factory on import.
 */
const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: CLIENT_EXTERNALS,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([node, client])
