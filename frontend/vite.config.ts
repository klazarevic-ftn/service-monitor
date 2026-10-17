import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        sveltekit({
            compilerOptions: {
                runes: ({ filename }) =>
                    filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            },

            adapter: adapter()
        })
    ],
    server: {
        host: '0.0.0.0',
        port: 5173,
        proxy: {
            '/api': 'http://127.0.0.1:3000'
        }
    }
});