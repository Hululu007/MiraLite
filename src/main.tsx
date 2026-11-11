import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { ensureEngine } from './lib/catSession'
import { inTauri } from './lib/cat'
import './index.css'

/**
 * 每次打开（页面加载）随机生成一组环境色相，驱动 index.css 里的彩色光晕。
 * 刻意不写 localStorage：关掉再开就是另一组颜色，玻璃面板折射的色光也会跟着变。
 */
function rollAmbientPalette() {
  const root = document.documentElement
  const h1 = Math.floor(Math.random() * 360)
  const h2 = (h1 + 52 + Math.floor(Math.random() * 96)) % 360
  const h3 = (h1 + 150 + Math.floor(Math.random() * 60) + 360) % 360
  const h4 = (h1 + 250 + Math.floor(Math.random() * 70) + 360) % 360

  root.style.setProperty('--li-h1', String(h1))
  root.style.setProperty('--li-h2', String(h2))
  root.style.setProperty('--li-h3', String(h3))
  root.style.setProperty('--li-h4', String(h4))
  root.style.setProperty('--li-rot', `${Math.floor(Math.random() * 360)}deg`)
  // 方便验证「每次打开都不同」，界面本身不显示
  root.dataset.ambientHue = String(h1)
}

rollAmbientPalette()

// 桌面版启动后预热 CAT 引擎（浏览器预览跳过）。
// 放在入口而不是某个页面，这样无论上次停在首页/设置/搜索，都能自动接上当前启用的订阅源。
// 不阻塞首屏渲染；失败也只影响 CAT 数据，界面会显示对应错误态。
// 用模块级 flag 防 StrictMode 下重复拉起。
let engineWarmed = false
if (inTauri() && !engineWarmed) {
  engineWarmed = true
  void ensureEngine().catch(() => {
    /* 预热失败交给各页面自行报错/重试 */
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
