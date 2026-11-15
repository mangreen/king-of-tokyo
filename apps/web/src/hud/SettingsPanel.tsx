import type { ReactNode } from 'react';
import type { ScenePrefs } from '../scene/prefs.js';
import type { QualitySetting, QualityTier } from '../scene/quality.js';

export const QUALITY_LABEL: Record<QualitySetting, string> = {
  auto: '自動',
  high: '高',
  medium: '中',
  low: '低',
};

interface Props {
  prefs: ScenePrefs;
  onChange: (patch: Partial<ScenePrefs>) => void;
  /** 這個瀏覽器能不能用 WebGL。 */
  canGL: boolean;
  /** 系統要求減少動態。 */
  reduced: boolean;
  /** 自動畫質目前降到哪一級。 */
  tier: QualityTier | null;
  /** 其他設定區塊（彈幕、新手教學…）。 */
  children?: ReactNode;
}

function Check({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={checked}
        {...(disabled === undefined ? {} : { disabled })}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />{' '}
      {children}
    </label>
  );
}

/**
 * 設定面板（HUD 分頁）：把 3D 場景、特效、彈幕、新手教學等設定集中在一處。
 * 3D 開著時全螢幕與「關閉 3D」在場景右下角；這裡也能開關 3D。
 */
export function SettingsPanel({ prefs, onChange, canGL, reduced, tier, children }: Props) {
  const motion = prefs.cameraMotion && !reduced;
  return (
    <div className="settings" data-testid="settings-panel">
      <fieldset>
        <legend>🎬 3D 場景</legend>
        {canGL ? (
          <Check
            checked={prefs.enabled}
            onChange={(on) => {
              onChange({ enabled: on });
            }}
          >
            顯示 3D 場景
          </Check>
        ) : (
          <p className="muted">這個瀏覽器不支援 WebGL，已使用純文字介面。</p>
        )}
        <label>
          畫質{' '}
          <select
            value={prefs.quality}
            disabled={!canGL || !prefs.enabled}
            onChange={(e) => {
              onChange({ quality: e.target.value as QualitySetting });
            }}
          >
            {(Object.keys(QUALITY_LABEL) as QualitySetting[]).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABEL[q]}
              </option>
            ))}
          </select>
          {prefs.quality === 'auto' && tier !== null && (
            <span className="muted">（已降為{QUALITY_LABEL[tier]}）</span>
          )}
        </label>
        <Check
          checked={motion}
          disabled={reduced}
          onChange={(on) => {
            onChange({ cameraMotion: on });
          }}
        >
          鏡頭動態與震動{reduced ? '（系統已要求減少動態）' : ''}
        </Check>
        <Check
          checked={prefs.follow && motion}
          disabled={!motion}
          onChange={(on) => {
            onChange({ follow: on });
          }}
        >
          鏡頭跟隨行動中的怪獸
        </Check>
        <Check
          checked={prefs.attackFx}
          onChange={(on) => {
            onChange({ attackFx: on });
          }}
        >
          怪獸招式特效（吐息、雷射、噴火…）
        </Check>
        <Check
          checked={prefs.cardFx}
          onChange={(on) => {
            onChange({ cardFx: on });
          }}
        >
          商店飛碟與卡牌特效
        </Check>
      </fieldset>
      {children}
    </div>
  );
}
