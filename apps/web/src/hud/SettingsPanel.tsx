import type { ReactNode } from 'react';
import type { ScenePrefs } from '../scene/prefs.js';
import { DANMAKU_OPACITY, DANMAKU_SIZE, DANMAKU_SPEED } from '../scene/danmaku.js';
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
  /** 飛過一則範例彈幕（讓人調整透明度與大小時看得到效果）；3D 關閉時不提供。 */
  onPreviewDanmaku?: () => void;
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
export function SettingsPanel({
  prefs,
  onChange,
  canGL,
  reduced,
  tier,
  onPreviewDanmaku,
  children,
}: Props) {
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
      <fieldset>
        <legend>💬 聊天彈幕</legend>
        <Check
          checked={prefs.danmaku}
          onChange={(on) => {
            onChange({ danmaku: on });
          }}
        >
          聊天訊息在 3D 場景上顯示為彈幕
        </Check>
        {!(canGL && prefs.enabled) && (
          <p className="muted">彈幕只會顯示在 3D 場景上；3D 關閉時請看「💬 聊天」分頁。</p>
        )}
        <label className="slider">
          <span>文字透明度</span>
          <input
            type="range"
            min={DANMAKU_OPACITY.min}
            max={DANMAKU_OPACITY.max}
            step={DANMAKU_OPACITY.step}
            value={prefs.danmakuOpacity}
            disabled={!prefs.danmaku}
            aria-label="彈幕文字透明度"
            onChange={(e) => {
              onChange({ danmakuOpacity: Number(e.target.value) });
            }}
          />
          <output>{Math.round(prefs.danmakuOpacity * 100)}%</output>
        </label>
        <label className="slider">
          <span>文字大小</span>
          <input
            type="range"
            min={DANMAKU_SIZE.min}
            max={DANMAKU_SIZE.max}
            step={DANMAKU_SIZE.step}
            value={prefs.danmakuSize}
            disabled={!prefs.danmaku}
            aria-label="彈幕文字大小"
            onChange={(e) => {
              onChange({ danmakuSize: Number(e.target.value) });
            }}
          />
          <output>{prefs.danmakuSize}px</output>
        </label>
        <label className="slider">
          <span>移動速度</span>
          <input
            type="range"
            min={DANMAKU_SPEED.min}
            max={DANMAKU_SPEED.max}
            step={DANMAKU_SPEED.step}
            value={prefs.danmakuSpeed}
            disabled={!prefs.danmaku}
            aria-label="彈幕移動速度"
            onChange={(e) => {
              onChange({ danmakuSpeed: Number(e.target.value) });
            }}
          />
          <output>{prefs.danmakuSpeed.toFixed(1)}×</output>
        </label>
        {onPreviewDanmaku && (
          <button type="button" disabled={!prefs.danmaku} onClick={onPreviewDanmaku}>
            預覽彈幕
          </button>
        )}
      </fieldset>
      {children}
    </div>
  );
}
