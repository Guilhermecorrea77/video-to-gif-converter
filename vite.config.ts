import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: funciona no GitHub Pages (/video-to-gif-converter/) e em qualquer pasta
  base: './',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Pré-empacota o codificador usado pelo worker (evita recarregar a página na 1ª conversão em dev)
  optimizeDeps: { include: ['gifenc'] },
  server: {
    // O AI Studio desliga o recarregamento automático com DISABLE_HMR
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
