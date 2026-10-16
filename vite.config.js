import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，打包后可以放到任意目录
  base: './',
  // 允许同一局域网的平板/手机访问开发服务器
  server: { host: true },
  // three.js 本身就有 600KB 左右，放宽体积提示
  build: { chunkSizeWarningLimit: 1000 },
});
