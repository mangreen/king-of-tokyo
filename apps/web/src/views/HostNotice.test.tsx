import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HostNotice, readOpen } from './HostNotice.js';

describe('HostNotice（房主模式說明區）', () => {
  it('預設收合：只有一行摘要，沒有 open 屬性；儲存不可用時也一樣', () => {
    expect(readOpen()).toBe(false);
    const html = renderToStaticMarkup(
      <HostNotice role="host" phase="lobby">
        <p>很長的說明</p>
      </HostNotice>,
    );
    expect(html).toContain('<details');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
    expect(html).toContain('房主模式');
    expect(html).toContain('你是房主');
    expect(html).toContain('點此展開');
  });

  it('客人與尚未連上的角色摘要', () => {
    expect(
      renderToStaticMarkup(
        <HostNotice role="guest" phase={null}>
          x
        </HostNotice>,
      ),
    ).toContain('你是客人');
    expect(
      renderToStaticMarkup(
        <HostNotice role={null} phase={null}>
          x
        </HostNotice>,
      ),
    ).not.toContain('你是');
  });
});
