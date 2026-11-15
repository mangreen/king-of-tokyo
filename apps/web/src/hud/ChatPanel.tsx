import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH } from '@kot/protocol';
import { seatColor } from '../scene/layout.js';
import type { ChatEntry } from '../state.js';

interface Props {
  entries: readonly ChatEntry[];
  selfId: string;
  onSend: (text: string) => void;
  /** 3D 關閉時彈幕不會顯示，這裡提醒一下。 */
  danmakuNote?: string;
}

/** 房內聊天（HUD 分頁）。3D 開著且彈幕開啟時，新訊息同時會飛過場景上方。 */
export function ChatPanel({ entries, selfId, onSend, danmakuNote }: Props) {
  const [text, setText] = useState('');
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const t = text.trim();
    if (t === '') return;
    onSend(t);
    setText('');
  };

  return (
    <div className="chat-panel" data-testid="chat-panel">
      <ol ref={list} className="chat-list" aria-live="polite" aria-label="聊天訊息">
        {entries.length === 0 && <li className="muted">還沒有人說話。打個招呼吧！</li>}
        {entries.map((m) => (
          <li key={m.id} className={m.from === selfId ? 'mine' : undefined}>
            <b
              className="chat-name"
              style={m.seat === null ? undefined : { color: seatColor(m.seat) }}
            >
              {m.nickname}
            </b>
            <span className="chat-text">{m.text}</span>
          </li>
        ))}
      </ol>
      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          placeholder="輸入訊息…"
          aria-label="聊天訊息"
          autoComplete="off"
          enterKeyHint="send"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <button type="submit" disabled={text.trim() === ''}>
          送出
        </button>
      </form>
      {danmakuNote && <p className="muted chat-note">{danmakuNote}</p>}
    </div>
  );
}
