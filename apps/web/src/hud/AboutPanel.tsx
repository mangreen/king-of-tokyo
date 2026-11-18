import githubMark from '../assets/github-mark.png';
import { ABOUT } from './about.js';

/** 「關於」分頁：一句話介紹、作者、版權聲明、GitHub 連結。內容刻意精簡。 */
export function AboutPanel() {
  return (
    <div className="about">
      <h3>
        {ABOUT.title} <small className="muted">{ABOUT.subtitle}</small>
      </h3>
      <p>
        把桌遊《King of Tokyo》做成可以和朋友連線的網頁遊戲：2–6 人、回合制、3D
        東京戰場。打倒對手、搶 20 分，或是當最後一隻活著的怪獸。
      </p>
      <p>
        作者：<strong>{ABOUT.author}</strong>
      </p>
      <p className="about-copyright">
        © {ABOUT.year} {ABOUT.author}。非官方粉絲專案，與 IELLO 無關。遊戲機制參考《King of
        Tokyo》（Richard Garfield 設計，IELLO 發行）；King of Tokyo
        及其相關名稱、商標屬於原權利人。本專案的怪獸、卡面與場景為原創設計。
      </p>
      <a
        className="about-repo"
        href={ABOUT.repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`GitHub 原始碼：${ABOUT.repoLabel}`}
      >
        <img src={githubMark} alt="" width={28} height={28} />
        <span>{ABOUT.repoLabel}</span>
      </a>
    </div>
  );
}
