import { useState, type FormEvent } from 'react';
import { NicknameSchema } from '@kot/protocol';

export function Login({
  onLogin,
  inviteCode,
}: {
  onLogin: (nickname: string) => void;
  /** 從邀請連結帶進來的房號；有的話登入後會自動加入。 */
  inviteCode?: string | null;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const parsed = NicknameSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? '暱稱不正確');
      return;
    }
    onLogin(parsed.data);
  }

  return (
    <form className="card" onSubmit={submit}>
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
      {error && <p className="error">{error}</p>}
      <button type="submit" className="primary">
        {inviteCode ? '加入房間' : '進入大廳'}
      </button>
    </form>
  );
}
