import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPrefs } from '../scene/prefs.js';
import { SettingsPanel } from './SettingsPanel.js';

const render = (over: Partial<Parameters<typeof SettingsPanel>[0]> = {}): string =>
  renderToStaticMarkup(
    <SettingsPanel
      prefs={defaultPrefs(false)}
      onChange={() => undefined}
      canGL
      reduced={false}
      tier={null}
      {...over}
    />,
  );

describe('SettingsPanel（設定面板）', () => {
  it('列出 3D 場景的全部設定', () => {
    const html = render();
    for (const text of [
      '顯示 3D 場景',
      '畫質',
      '鏡頭動態與震動',
      '鏡頭跟隨行動中的怪獸',
      '怪獸招式特效',
      '商店飛碟與卡牌特效',
    ])
      expect(html).toContain(text);
  });

  it('自動畫質降級時顯示目前等級；其他區塊（彈幕、教學）放在後面', () => {
    const html = render({ tier: 'low', children: <fieldset>彈幕設定</fieldset> });
    expect(html).toContain('已降為低');
    expect(html.indexOf('彈幕設定')).toBeGreaterThan(html.indexOf('商店飛碟與卡牌特效'));
  });

  it('系統要求減少動態：鏡頭動態與跟隨不能勾', () => {
    const html = render({ reduced: true });
    expect(html).toContain('系統已要求減少動態');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('沒有 WebGL：說明已改用純文字介面，且沒有「顯示 3D」選項', () => {
    const html = render({ canGL: false });
    expect(html).toContain('不支援 WebGL');
    expect(html).not.toContain('顯示 3D 場景');
  });
});
