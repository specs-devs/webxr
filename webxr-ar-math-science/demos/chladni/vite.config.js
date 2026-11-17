import { resolve } from 'node:path'
import glsl from 'vite-plugin-glsl'

export default {
    root: './',
    publicDir: './public/',
    base: '/demos/chladni/',
    server:
    {
        host: true,
        open: !('SANDBOX_URL' in process.env || 'CODESANDBOX_HOST' in process.env)
    },
    build:
    {
        outDir: './dist',
        emptyOutDir: true,
        sourcemap: true,
        lib: {
            entry: resolve(__dirname, 'src/experience.js'),
            formats: ['es'],
            fileName: () => 'assets/experience.js'
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true
            }
        }
    },
    plugins:
    [
        glsl()
    ]
}
