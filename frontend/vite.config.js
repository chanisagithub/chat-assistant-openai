import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    isCustomElement: (tag) => tag.startsWith('voice-assistant-')
                }
            }
        }),
        cssInjectedByJsPlugin(),
    ],
    build: {
        outDir: 'dist',
        cssCodeSplit: false,
        rollupOptions: {
            input: './src/main.js',
            output: {
                format: 'iife',
                dir: 'dist', // Output directory
                entryFileNames: 'voice-assistant-plugin.js', // Output filename for the entry chunk
                name: 'VoiceAssistantPlugin',
                inlineDynamicImports: true,
                globals: {
                    // vue: 'Vue' // Specify how the 'vue' module is accessed globally
                }
            },
            // external: ['vue']
        },
        css: {
            extract: 'voice-assistant-plugin.css',
        },
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url))
            }
        }
    }
});