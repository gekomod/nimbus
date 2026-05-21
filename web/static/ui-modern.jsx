// ===== Modern UI primitives =====
// CountUp · Toasts · MiniSpark · Swimlane · pulse halo

const { useState: useSU, useEffect: useEU, useRef: useRU } = React;

// ---------- CountUp (animated number) ----------
// Easing: easeOutCubic. Honors prefers-reduced-motion.
const CountUp = ({ value, duration = 700, decimals = 0, separator = " ", prefix = "", suffix = "" }) => {
  const [v, setV] = useSU(typeof value === "number" ? value : 0);
  const startVal = useRU(typeof value === "number" ? value : 0);
  const startTime = useRU(null);
  const rafRef = useRU(null);
  const target = typeof value === "number" ? value : 0;

  useEU(() => {
    const reduce = matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setV(target); return; }
    cancelAnimationFrame(rafRef.current);
    startVal.current = v;
    startTime.current = null;
    const tick = (t) => {
      if (startTime.current === null) startTime.current = t;
      const p = Math.min(1, (t - startTime.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(startVal.current + (target - startVal.current) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const formatted = v.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{prefix}{formatted}{suffix}</span>;
};

// ---------- Toast system ----------
const TOAST_ICONS = {
  success: "check",
  error:   "close",
  warning: "bell",
  info:    "log",
  loading: "refresh",
};
const TOAST_COLORS = {
  success: "var(--ok)",
  error:   "var(--err)",
  warning: "var(--warn)",
  info:    "var(--info)",
  loading: "var(--accent)",
};

const ToastContainer = () => {
  const [toasts, setToasts] = useSU([]);

  useEU(() => {
    const handler = (e) => {
      const t = { id: Math.random().toString(36).slice(2, 9), ...e.detail };
      setToasts(curr => [...curr, t]);
      if (t.type !== "loading" && (t.duration !== Infinity)) {
        setTimeout(() => {
          setToasts(curr => curr.filter(x => x.id !== t.id));
        }, t.duration || 3800);
      }
    };
    const dismiss = (e) => {
      setToasts(curr => curr.filter(x => x.id !== e.detail.id));
    };
    window.addEventListener("__toast", handler);
    window.addEventListener("__toast_dismiss", dismiss);
    return () => {
      window.removeEventListener("__toast", handler);
      window.removeEventListener("__toast_dismiss", dismiss);
    };
  }, []);

  return (
    <div className="toast-stack">
      {toasts.map((t, i) => {
        const color = TOAST_COLORS[t.type] || "var(--accent)";
        return (
          <div key={t.id} className="toast glass" style={{
            "--toast-color": color,
            animationDelay: `${i * 30}ms`,
          }}>
            <div className="toast-icon" style={{ color }}>
              <Icon name={TOAST_ICONS[t.type] || "log"} size={14}/>
            </div>
            <div className="toast-body">
              {t.title && <div className="toast-title">{t.title}</div>}
              {t.message && <div className="toast-msg">{t.message}</div>}
            </div>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => { try { t.action.onClick && t.action.onClick(); } catch {} ; window.dispatchEvent(new CustomEvent("__toast_dismiss", { detail: { id: t.id } })); }}
              >{t.action.label}</button>
            )}
            <button
              className="toast-close"
              onClick={() => window.dispatchEvent(new CustomEvent("__toast_dismiss", { detail: { id: t.id } }))}
              aria-label="zamknij"
            ><Icon name="close" size={11}/></button>
            {t.type !== "loading" && (
              <div className="toast-bar" style={{ "--dur": `${t.duration || 3800}ms`, background: color }}/>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Public API
window.toast = (opts) => {
  const detail = typeof opts === "string" ? { type: "info", message: opts } : opts;
  window.dispatchEvent(new CustomEvent("__toast", { detail }));
};
window.toast.success = (msg, extra = {}) => window.toast({ type: "success", message: msg, ...extra });
window.toast.error   = (msg, extra = {}) => window.toast({ type: "error",   message: msg, ...extra });
window.toast.warn    = (msg, extra = {}) => window.toast({ type: "warning", message: msg, ...extra });
window.toast.info    = (msg, extra = {}) => window.toast({ type: "info",    message: msg, ...extra });
window.toast.loading = (msg, extra = {}) => window.toast({ type: "loading", message: msg, duration: Infinity, ...extra });

// ---------- MiniSpark (inline sparkline for table rows) ----------
const MiniSpark = ({ data, color = "var(--accent)", width = 80, height = 22, fill = true, dotLast = true }) => {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = Math.max(1, max - min);
  const padY = 2;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - padY - ((v - min) / range) * (height - padY * 2),
  ]);
  const path = "M " + pts.map(p => p.join(",")).join(" L ");
  const area = `M ${pts[0][0]},${height} L ${pts.map(p => p.join(",")).join(" L ")} L ${pts[pts.length-1][0]},${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={area} fill={color} opacity="0.12"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      {dotLast && <circle cx={last[0]} cy={last[1]} r="2.2" fill={color}/>}
    </svg>
  );
};

// ---------- Swimlane (horizontal 7-day activity) ----------
// rows: [{ label, color, blocks: [{ start, end, kind }] }] (start/end in 0..1)
const Swimlane = ({ rows, days = 7, labels }) => {
  const labelW = 130;
  const rowH = 34;
  const gap = 6;
  const W = 760;
  const innerW = W - labelW - 10;
  const tickXs = Array.from({ length: days + 1 }, (_, i) => labelW + (i / days) * innerW);
  const dayLabels = labels || ["pon","wt","śr","czw","pt","sob","ndz"];
  const totalH = rows.length * (rowH + gap) + 20;

  return (
    <svg viewBox={`0 0 ${W} ${totalH}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* day grid */}
      {tickXs.map((x, i) => (
        <line key={i} x1={x} x2={x} y1="0" y2={totalH - 14}
          stroke="var(--line)" strokeDasharray={i === days ? "0" : "2 4"} strokeOpacity={i === days || i === 0 ? "0.6" : "0.35"}/>
      ))}
      {dayLabels.map((l, i) => (
        <text key={i} x={labelW + ((i + 0.5) / days) * innerW} y={totalH - 4}
          textAnchor="middle" fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)">{l}</text>
      ))}
      {/* "now" marker */}
      <line x1={labelW + 0.92 * innerW} x2={labelW + 0.92 * innerW} y1="0" y2={totalH - 14}
        stroke="var(--accent)" strokeWidth="1.2" strokeOpacity="0.6"/>
      <text x={labelW + 0.92 * innerW} y="-2" textAnchor="middle" fontSize="9" fill="var(--accent)" fontFamily="var(--font-mono)">teraz</text>

      {/* rows */}
      {rows.map((r, ri) => {
        const y = ri * (rowH + gap);
        return (
          <g key={ri}>
            {/* label */}
            <foreignObject x="0" y={y} width={labelW - 10} height={rowH}>
              <div style={{
                display: "flex", alignItems: "center", height: "100%",
                fontSize: 11, color: "var(--fg)", fontWeight: 500,
                paddingLeft: 4, gap: 7,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }}/>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
              </div>
            </foreignObject>
            {/* track */}
            <rect x={labelW} y={y + rowH/2 - 8} width={innerW} height={16}
              rx="3" fill="var(--bg-3)" opacity="0.5"/>
            {/* blocks */}
            {r.blocks.map((b, bi) => {
              const x = labelW + b.start * innerW;
              const w = Math.max(2, (b.end - b.start) * innerW);
              const color = b.color || r.color;
              return (
                <g key={bi}>
                  <rect x={x} y={y + rowH/2 - 8} width={w} height={16}
                    rx="3" fill={color}
                    style={{ filter: b.kind === "fail" ? "saturate(1.2)" : undefined }}
                  >
                    <title>{b.label || ""}</title>
                  </rect>
                  {b.kind === "fail" && (
                    <rect x={x} y={y + rowH/2 - 8} width={w} height={16}
                      rx="3" fill="url(#fail-hatch)" pointerEvents="none"/>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
      <defs>
        <pattern id="fail-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="transparent"/>
          <line x1="0" y1="0" x2="0" y2="6" stroke="white" strokeOpacity="0.35" strokeWidth="2"/>
        </pattern>
      </defs>
    </svg>
  );
};

// ---------- Pulse halo (decorative live indicator) ----------
const PulseDot = ({ color = "var(--ok)", size = 8 }) => (
  <span style={{ position: "relative", display: "inline-flex", width: size, height: size }}>
    <span style={{
      position: "absolute", inset: 0, borderRadius: "50%",
      background: color, opacity: 0.45,
      animation: "pulse-halo 2s cubic-bezier(0,0,.2,1) infinite",
    }}/>
    <span style={{
      position: "relative", width: size, height: size, borderRadius: "50%",
      background: color, boxShadow: `0 0 6px ${color}`,
    }}/>
  </span>
);

window.CountUp = CountUp;
window.ToastContainer = ToastContainer;
window.MiniSpark = MiniSpark;
window.Swimlane = Swimlane;
window.PulseDot = PulseDot;
