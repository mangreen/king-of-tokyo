import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('沒有任何環境變數時使用安全預設值', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3001,
      allowedOrigins: ['http://localhost:5173'],
      maxRooms: 2000,
    });
  });

  it('解析逗號分隔的來源並去除空白', () => {
    const config = loadConfig({ ALLOWED_ORIGINS: ' http://a.test , https://b.test ,' });
    expect(config.allowedOrigins).toEqual(['http://a.test', 'https://b.test']);
  });

  it('MAX_ROOMS 可設定，且必須是正整數', () => {
    expect(loadConfig({ MAX_ROOMS: '50' }).maxRooms).toBe(50);
    expect(() => loadConfig({ MAX_ROOMS: '0' })).toThrow(/環境變數設定錯誤/);
    expect(() => loadConfig({ MAX_ROOMS: 'many' })).toThrow(/環境變數設定錯誤/);
  });

  it('拒絕萬用字元來源', () => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: '*' })).toThrow(/萬用字元/);
  });

  it('拒絕不合法的 port 與 NODE_ENV', () => {
    expect(() => loadConfig({ SERVER_PORT: '99999' })).toThrow(/環境變數設定錯誤/);
    expect(() => loadConfig({ SERVER_PORT: 'abc' })).toThrow(/環境變數設定錯誤/);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/環境變數設定錯誤/);
  });

  it('錯誤訊息不回顯變數值', () => {
    let message = '';
    try {
      loadConfig({ SERVER_PORT: 'super-secret-value' });
    } catch (error) {
      message = String(error);
    }
    // 先確認確實丟出錯誤，再確認訊息不含原始值
    expect(message).toMatch(/環境變數設定錯誤/);
    expect(message).not.toContain('super-secret-value');
  });
});
