import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

// 離線 3D 展示頁（?scene-demo）：開發與畫面驗證用，不連伺服器
const Demo = lazy(() => import('./scene/Demo.js'));
const demo = new URLSearchParams(window.location.search).has('scene-demo');

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 節點');
}

createRoot(container).render(
  <StrictMode>
    {demo ? (
      <main className="wide">
        <Suspense fallback={<p>載入中…</p>}>
          <Demo />
        </Suspense>
      </main>
    ) : (
      <App />
    )}
  </StrictMode>,
);
