import { useState } from 'react';
import { inviteUrl } from '../invite.js';

/** 房間邀請連結：複製、（手機等支援時）系統分享。朋友點開連結、輸入暱稱就會自動加入。 */
export function ShareLink({ code }: { code: string }) {
  const [feedback, setFeedback] = useState<string | null>(null);
  const link = inviteUrl(window.location.href, code);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  function tell(message: string): void {
    setFeedback(message);
    window.setTimeout(() => {
      setFeedback(null);
    }, 2500);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      tell('已複製連結 ✓');
    } catch {
      // 沒有剪貼簿權限（非 https、舊瀏覽器）：選取文字讓玩家自己複製
      const input = document.getElementById('invite-link');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      tell('請按 Ctrl／⌘ + C 複製');
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ title: '東京之王', text: `來玩東京之王！房號 ${code}`, url: link });
    } catch {
      // 使用者取消分享：不需處理
    }
  }

  return (
    <div className="share-link">
      <label htmlFor="invite-link">邀請連結（朋友點開、輸入暱稱就會加入這個房間）</label>
      <div className="row">
        <input
          id="invite-link"
          readOnly
          value={link}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => {
            void copy();
          }}
        >
          複製連結
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => {
              void share();
            }}
          >
            分享…
          </button>
        )}
      </div>
      <p className="muted" role="status" aria-live="polite">
        {feedback ?? `房號 ${code}（也可以在大廳輸入房號加入）`}
      </p>
    </div>
  );
}
