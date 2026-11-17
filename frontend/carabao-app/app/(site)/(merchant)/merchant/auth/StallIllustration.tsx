// A farm stall with produce, a delivery truck and trees. Decorative only.

const STRIPES = 7;

export default function StallIllustration({ className }: { className?: string }) {
  const awningX = 150;
  const awningW = 210;
  const stripeW = awningW / STRIPES;

  return (
    <svg className={className} viewBox="0 0 440 280" aria-hidden="true" focusable="false">
      {/* Sky details */}
      <circle cx="388" cy="40" r="20" fill="#fbd46d" />
      <g fill="#dbe9df">
        <circle cx="46" cy="64" r="14" />
        <circle cx="62" cy="56" r="18" />
        <circle cx="80" cy="66" r="12" />
        <rect x="40" y="64" width="50" height="14" rx="7" />
      </g>

      {/* Ground */}
      <ellipse cx="235" cy="252" rx="200" ry="10" fill="#dfe8e1" />

      {/* Stall: back wall, posts, counter */}
      <rect x="160" y="96" width="190" height="96" fill="#fdf8ec" />
      <rect x="160" y="96" width="8" height="152" fill="#8a5a3b" />
      <rect x="342" y="96" width="8" height="152" fill="#8a5a3b" />
      <rect x="150" y="188" width="210" height="60" rx="4" fill="#a86f48" />
      <rect x="150" y="188" width="210" height="10" rx="3" fill="#8a5a3b" />
      <g stroke="#8a5a3b" strokeWidth="2" opacity="0.45">
        <line x1="150" y1="214" x2="360" y2="214" />
        <line x1="150" y1="232" x2="360" y2="232" />
      </g>

      {/* Sign with a leaf */}
      <rect x="225" y="110" width="60" height="30" rx="6" fill="#133520" />
      <path d="M244 132c0-10 8-16 22-16 0 13-7 19-18 19" fill="#5ccf8a" />
      <path d="M244 133l12-10" stroke="#133520" strokeWidth="2" strokeLinecap="round" />

      {/* Awning: stripes and a scalloped edge */}
      <rect x={awningX} y="60" width={awningW} height="10" rx="3" fill="#1d5c36" />
      {Array.from({ length: STRIPES }, (_, i) => (
        <rect
          key={`s${i}`}
          x={awningX + i * stripeW}
          y="68"
          width={stripeW}
          height="26"
          fill={i % 2 === 0 ? "#2f9e5f" : "#f4ead0"}
        />
      ))}
      {Array.from({ length: STRIPES }, (_, i) => (
        <circle
          key={`c${i}`}
          cx={awningX + i * stripeW + stripeW / 2}
          cy="94"
          r={stripeW / 2}
          fill={i % 2 === 0 ? "#2f9e5f" : "#f4ead0"}
        />
      ))}

      {/* Crates on the counter */}
      <g>
        <rect x="168" y="164" width="54" height="26" rx="3" fill="#c98d5e" />
        <circle cx="180" cy="162" r="8" fill="#e5483b" />
        <circle cx="195" cy="160" r="8" fill="#ef5a4a" />
        <circle cx="210" cy="162" r="8" fill="#e5483b" />
        <circle cx="187" cy="152" r="7" fill="#f06b5a" />
        <circle cx="203" cy="152" r="7" fill="#e5483b" />
      </g>
      <g>
        <rect x="228" y="164" width="54" height="26" rx="3" fill="#c98d5e" />
        <ellipse cx="242" cy="156" rx="12" ry="10" fill="#3fae6b" />
        <ellipse cx="258" cy="152" rx="13" ry="12" fill="#2f9e5f" />
        <ellipse cx="270" cy="158" rx="11" ry="9" fill="#4cbd78" />
      </g>
      <g>
        <rect x="288" y="164" width="54" height="26" rx="3" fill="#c98d5e" />
        {[0, 1, 2, 3].map((i) => (
          <g key={i} transform={`translate(${298 + i * 11} 146) rotate(${-12 + i * 8})`}>
            <path d="M0 0l5 20 5-20z" fill="#f08a24" />
            <path d="M2 -6l3 6 3-6" stroke="#3fae6b" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
        ))}
      </g>
      <g stroke="#a86f48" strokeWidth="2" opacity="0.6">
        <line x1="168" y1="177" x2="222" y2="177" />
        <line x1="228" y1="177" x2="282" y2="177" />
        <line x1="288" y1="177" x2="342" y2="177" />
      </g>

      {/* Delivery truck */}
      <g>
        <rect x="30" y="170" width="84" height="62" rx="6" fill="#2f9e5f" />
        <path d="M114 186h24l18 22v24h-42z" fill="#1d5c36" />
        <path d="M120 192h16l12 15h-28z" fill="#cfe9d8" />
        <rect x="46" y="186" width="52" height="26" rx="4" fill="#f4ead0" />
        <path d="M64 206c0-8 6-13 17-13 0 10-5 15-14 15" fill="#2f9e5f" />
        <circle cx="58" cy="236" r="13" fill="#24352a" />
        <circle cx="58" cy="236" r="5" fill="#dfe8e1" />
        <circle cx="134" cy="236" r="13" fill="#24352a" />
        <circle cx="134" cy="236" r="5" fill="#dfe8e1" />
      </g>

      {/* Trees */}
      <g>
        <rect x="386" y="196" width="5" height="52" fill="#8a5a3b" />
        <ellipse cx="388" cy="188" rx="22" ry="30" fill="#3fae6b" />
        <rect x="410" y="214" width="4" height="34" fill="#8a5a3b" />
        <ellipse cx="412" cy="208" rx="13" ry="18" fill="#7cc99a" />
      </g>
    </svg>
  );
}
