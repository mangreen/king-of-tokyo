import { useEffect, useState, type FormEvent } from 'react';
import { NicknameSchema, RoomCodeSchema } from '@kot/protocol';
import { MODE_LABEL, type Mode } from '../net/mode.js';
import { offlineReady } from '../pwa/register.js';

export function Login({
  onLogin,
  inviteCode,
  hostMode = false,
  mode,
  onModeChange,
}: {
  onLogin: (nickname: string, roomCode?: string) => void;
  /** 從邀請連結帶進來的房號；有的話登入後會自動加入。 */
  inviteCode?: string | null;
  /** 房主模式：可以輸入朋友的房號加入；留空就是自己當房主。 */
  hostMode?: boolean;
  /** 目前的連線模式，以及切換（會重新載入頁面）。 */
  mode?: Mode;
  onModeChange?: (mode: Mode) => void;
}) {
  const [cached, setCached] = useState(false);
  useEffect(() => {
    void offlineReady().then(setCached);
  }, []);
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const parsed = NicknameSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '暱稱不正確');
      return;
    }
    if (hostMode && inviteCode === null && code.trim() !== '') {
      const room = RoomCodeSchema.safeParse(code);
      if (!room.success) {
        setError('房號格式不正確（5 個字母或數字）');
        return;
      }
      onLogin(parsed.data, room.data);
      return;
    }
    onLogin(parsed.data, inviteCode ?? undefined);
  }

  return (
    <form className="card login-form" onSubmit={submit}>
      {mode !== undefined && onModeChange !== undefined && !inviteCode && (
        <fieldset className="mode-picker" data-testid="mode-picker">
          <legend>玩法</legend>
          {(['p2p', 'offline', 'server'] as const).map((m) => (
            <label key={m} className={mode === m ? 'on' : undefined}>
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  if (m !== mode) onModeChange(m);
                }}
              />
              <span>
                <strong>{MODE_LABEL[m].title}</strong>
                <small className="muted">{MODE_LABEL[m].hint}</small>
              </span>
            </label>
          ))}
          {mode === 'offline' && (
            <small className="muted" data-testid="offline-cache-hint">
              {cached
                ? '✓ 已存進這個瀏覽器：之後沒有網路也能開啟離線單機。'
                : '第一次需要連網載入頁面；載入完成後會存進瀏覽器，之後沒有網路也能開啟。'}
            </small>
          )}
        </fieldset>
      )}
      <h2>輸入暱稱</h2>
      {inviteCode && (
        <p className="invite-banner" role="status">
          你被邀請加入房間 <span className="room-code">{inviteCode}</span>，輸入暱稱就會自動加入。
        </p>
      )}
      <p className="muted">不需要註冊。暱稱只用於這次遊玩，其他玩家看得到。</p>
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        placeholder="例如：哥吉拉Fan"
        maxLength={20}
        aria-label="暱稱"
        autoFocus
      />
      {hostMode && !inviteCode && (
        <>
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            placeholder="朋友的房號（沒有就留空，自己當房主）"
            maxLength={5}
            aria-label="房號"
            data-testid="room-code-input"
          />
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary">
        {inviteCode || code.trim() !== '' ? '加入房間' : hostMode ? '當房主' : '進入大廳'}
      </button>
    </form>
  );
}
