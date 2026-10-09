import { useEffect, useState } from 'react';
import type { RobustnessReport } from '@miko/engine';
import { sound } from '../../lib/sound.ts';
import { fx } from '../../lib/fx.ts';

const GRADE_TITLE: Record<string, string> = { S: 'LEGENDARY', A: 'EPIC', B: 'RARE', C: 'COMMON', D: 'FRAGILE' };

/** Gacha-style card flip revealing the S/A/B/C/D robustness grade. */
export function GradeReveal({ report }: { report: RobustnessReport }) {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    sound.play('reveal');
    const t = window.setTimeout(() => {
      setFlipped(true);
      const el = document.querySelector('.grade-card');
      const { x, y } = fx.centerOf(el);
      if (report.grade === 'S' || report.grade === 'A') { fx.flash('rgba(255,210,63,0.5)'); fx.confetti(120); fx.burst(x, y, 'win', 40); }
      else if (report.grade === 'B') fx.burst(x, y, 'spark', 30);
      else fx.burst(x, y, 'lesson', 14);
    }, 850);
    return () => window.clearTimeout(t);
  }, [report]);

  return (
    <div className="grade-reveal">
      <div className={`grade-card g-${report.grade} ${flipped ? 'flipped' : ''}`}>
        <div className="grade-face back"><span>?</span></div>
        <div className="grade-face front">
          <span className="grade-rarity">{GRADE_TITLE[report.grade]}</span>
          <span className="grade-letter">{report.grade}</span>
          <span className="grade-score num">{Math.round(report.score)}/100</span>
        </div>
      </div>
      {flipped && (
        <div className="reason-chips">
          {report.reasons.map((r, i) => <span key={i} className="reason" style={{ animationDelay: `${150 + i * 120}ms` }}>{r}</span>)}
        </div>
      )}
    </div>
  );
}
