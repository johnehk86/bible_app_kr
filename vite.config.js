import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './', // 상대경로 빌드 → GitHub Pages 하위 경로, 앱 래핑 어디서든 동작
})
