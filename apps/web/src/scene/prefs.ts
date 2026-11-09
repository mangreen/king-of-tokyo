import { parseQualitySetting, type QualitySetting } from './quality.js';

export interface ScenePrefs {
  /** 關掉 3D 場景（回到純文字介面）。 */
  enabled: boolean;
  quality: QualitySetting;
  /** 鏡頭運動、震動與命中停頓。 */
  cameraMotion: boolean;
}

const KEY = 'kot.scene.prefs.v1';

export function defaultPrefs(reducedMotion: boolean): ScenePrefs {
  return { enabled: true, quality: 'auto', cameraMotion: !reducedMotion };
}

/** 解析儲存的偏好；任何壞資料都退回預設（不信任 localStorage 的內容）。 */
export function parsePrefs(raw: string | null, reducedMotion: boolean): ScenePrefs {
  const base = defaultPrefs(reducedMotion);
  if (raw === null) return base;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return base;
    const o = v as Record<string, unknown>;
    return {
      enabled: typeof o['enabled'] === 'boolean' ? o['enabled'] : base.enabled,
      quality: parseQualitySetting(o['quality']),
      cameraMotion: typeof o['cameraMotion'] === 'boolean' ? o['cameraMotion'] : base.cameraMotion,
    };
  } catch {
    return base;
  }
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 監聽系統「減少動態」設定的變化；回傳取消函式。 */
export function watchReducedMotion(onChange: (reduced: boolean) => void): () => void {
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent): void => {
      onChange(e.matches);
    };
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
    };
  } catch {
    return () => undefined;
  }
}

export function loadPrefs(): ScenePrefs {
  const reduced = prefersReducedMotion();
  try {
    return parsePrefs(window.localStorage.getItem(KEY), reduced);
  } catch {
    return defaultPrefs(reduced);
  }
}

export function savePrefs(prefs: ScenePrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 私密視窗或被封鎖：這只是便利功能，忽略
  }
}

/** 這個瀏覽器能不能建立 WebGL。 */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** 房間代碼 → 城市外觀種子（只影響外觀，所有玩家一致）。 */
export function seedFromCode(code: string): number {
  let h = 2166136261;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
