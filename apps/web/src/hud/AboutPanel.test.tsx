import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ABOUT } from './about.js';
import { AboutPanel } from './AboutPanel.js';

describe('AboutPanel（關於）', () => {
  const html = renderToStaticMarkup(<AboutPanel />);

  it('有遊戲簡介、作者與版權聲明（非官方、原權利人、原創素材）', () => {
    expect(html).toContain('東京之王');
    expect(html).toContain('作者');
    expect(html).toContain(ABOUT.author);
    expect(html).toContain(`© ${String(ABOUT.year)}`);
    expect(html).toContain('非官方');
    expect(html).toContain('IELLO');
    expect(html).toContain('原創');
  });

  it('GitHub 連結：指向這個 repo，另開分頁並帶 noopener', () => {
    expect(ABOUT.repoUrl).toBe('https://github.com/mangreen/king-of-tokyo');
    expect(html).toContain(`href="${ABOUT.repoUrl}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<img');
  });
});
