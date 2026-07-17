import { useEffect, useRef, useState } from 'react';

interface Props {
  side: 'largo' | 'corto';
  /** Ring color. */
  color: string;
}

// Strip geometry (px), measured across the bound edge:
const ACROSS = 26; // total strip thickness
const EDGE = 12; // paper edge within the strip
const HOLE = 17; // hole position, just inside the paper
const BULGE = 1.5; // outermost point of the loop (over the spine)
const PITCH = 8; // distance between holes (denser coil)
const HOLE_R = 2;

/**
 * Spiral (wire-o) binding drawn with SVG: each loop leaves its hole at the top,
 * bulges out over the spine, and dips back behind the paper halfway to the next
 * hole — a flattened, slanted coil, not a perfect circle.
 */
export function SpiralBinding({ side, color }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const largo = side === 'largo';
  const along = largo ? size.h : size.w; // length of the bound edge
  const ready = size.w > 0 && size.h > 0 && along > 20;

  const n = ready ? Math.max(2, Math.round((along - 10) / PITCH)) : 0;
  const step = n > 1 ? (along - 10) / (n - 1) : 0;
  const dip = step / 2;

  const loops: { d: string; cx: number; cy: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = 5 + i * step; // position along the edge
    if (largo) {
      loops.push({
        d: `M ${HOLE} ${p} C ${BULGE} ${p} ${BULGE} ${p + dip} ${EDGE} ${p + dip}`,
        cx: HOLE,
        cy: p,
      });
    } else {
      loops.push({
        d: `M ${p} ${HOLE} C ${p} ${BULGE} ${p + dip} ${BULGE} ${p + dip} ${EDGE}`,
        cx: p,
        cy: HOLE,
      });
    }
  }

  const vbW = largo ? ACROSS : size.w;
  const vbH = largo ? size.h : ACROSS;

  return (
    <div ref={ref} className={`spiral spiral-${side}`} aria-hidden>
      {ready && (
        <svg width="100%" height="100%" viewBox={`0 0 ${vbW} ${vbH}`} preserveAspectRatio="none">
          {loops.map((l, i) => (
            <path
              key={`p${i}`}
              className="coil-draw"
              pathLength={1}
              style={{ strokeDasharray: 1, animationDelay: `${i * 28}ms` }}
              d={l.d}
              fill="none"
              stroke={color}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          ))}
          {loops.map((l, i) => (
            <circle
              key={`h${i}`}
              className="coil-hole"
              style={{ animationDelay: `${i * 28}ms` }}
              cx={l.cx}
              cy={l.cy}
              r={HOLE_R}
              fill="#0d0d0d"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth={0.8}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
