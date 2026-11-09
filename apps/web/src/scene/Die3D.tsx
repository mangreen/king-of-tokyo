import type { Face } from '@kot/rules';
import { cubeTransform } from './dice.js';

const SIDES: { key: string; text: string; cls: string }[] = [
  { key: '1', text: '1', cls: 'front' },
  { key: '2', text: '2', cls: 'back' },
  { key: '3', text: '3', cls: 'right' },
  { key: 'attack', text: '💥', cls: 'left' },
  { key: 'heal', text: '❤️', cls: 'top' },
  { key: 'energy', text: '⚡', cls: 'bottom' },
];

const FACE_LABEL: Record<string, string> = {
  '1': '1',
  '2': '2',
  '3': '3',
  attack: '爪擊',
  heal: '治療',
  energy: '能量',
};

/** 一顆 CSS 3D 骰子：轉到伺服器決定的那一面。 */
export function Die3D({ face, spin }: { face: Face; spin: number }) {
  return (
    <span className="die3d" role="img" aria-label={FACE_LABEL[String(face)] ?? String(face)}>
      <span className="cube" style={{ transform: cubeTransform(face, spin) }}>
        {SIDES.map((s) => (
          <span key={s.key} className={`side ${s.cls}${s.key === String(face) ? ' up' : ''}`}>
            {s.text}
          </span>
        ))}
      </span>
    </span>
  );
}
