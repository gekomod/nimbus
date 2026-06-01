// ===== Download Center — design: new.jsx, API: screens-downloads.jsx =====
const { useState, useEffect, useRef, useCallback } = React;

// ─── Stałe ────────────────────────────────────────────────────────────────────

const DL_CATEGORIES = [
  { id: "all",     label: "wszystkie",   icon: "download", color: "var(--accent)" },
  { id: "movies",  label: "filmy",       icon: "media",    color: "oklch(0.72 0.14 150)" },
  { id: "series",  label: "seriale",     icon: "media",    color: "oklch(0.78 0.15 75)" },
  { id: "music",   label: "muzyka",      icon: "media",    color: "oklch(0.7 0.13 320)" },
  { id: "books",   label: "książki",     icon: "log",      color: "oklch(0.7 0.13 220)" },
  { id: "iso",     label: "ISO",         icon: "disk",     color: "oklch(0.68 0.12 290)" },
  { id: "cda",     label: "CDA.pl",      icon: "media",    color: "oklch(0.7 0.15 25)" },
  { id: "sibnet",  label: "Sibnet",      icon: "media",    color: "oklch(0.7 0.14 15)" },
  { id: "yt",      label: "YouTube",     icon: "media",    color: "oklch(0.7 0.14 320)" },
  { id: "torrent", label: "torrent",     icon: "download", color: "oklch(0.7 0.15 280)" },
  { id: "file",    label: "inne",        icon: "package",  color: "var(--fg-dim)" },
];

const DL_STATE_META = {
  downloading: { label: "POBIERA",    color: "var(--accent)", icon: "download" },
  seeding:     { label: "SEEDUJE",    color: "var(--ok)",     icon: "upload"   },
  queued:      { label: "W KOLEJCE",  color: "var(--info)",   icon: "clock"    },
  paused:      { label: "PAUZA",      color: "var(--warn)",   icon: "pause"    },
  done:        { label: "ZAKOŃCZONE", color: "var(--fg-dim)", icon: "check"    },
  completed:   { label: "ZAKOŃCZONE", color: "var(--fg-dim)", icon: "check"    },
  error:       { label: "BŁĄD",       color: "var(--err)",    icon: "close"    },
  cancelled:   { label: "ANULOWANO",  color: "var(--fg-dim)", icon: "close"    },
};

const DL_KIND_META = {
  torrent: { label: "torrent", color: "oklch(0.7 0.15 280)" },
  usenet:  { label: "usenet",  color: "oklch(0.72 0.14 150)" },
  http:    { label: "http",    color: "oklch(0.7 0.13 220)" },
  cda:     { label: "cda",     color: "oklch(0.7 0.15 25)"  },
  sibnet:  { label: "sibnet",  color: "oklch(0.7 0.14 15)"  },
  yt:      { label: "yt-dlp",  color: "oklch(0.7 0.14 320)" },
  file:    { label: "http",    color: "oklch(0.7 0.13 220)" },
  iso:     { label: "iso",     color: "oklch(0.68 0.12 290)"},
};

const DL_QUOTAS = [
  { label: "Pobrane dziś",     value: null, unit: "GB", color: "var(--accent)", barPct: 0, of: "dzienny limit" },
  { label: "Wysłane dziś",     value: null, unit: "GB", color: "var(--ok)",     barPct: 0, of: "" },
  { label: "Ratio (globalny)", value: null, unit: "",   color: "oklch(0.78 0.15 75)", barPct: 0, of: "cel ≥ 1.00" },
  { label: "Aktywne torrenty", value: null, unit: "",   color: "var(--info)",   barPct: 0, of: "limit 15" },
];

const DL_SPEED_HISTORY_EMPTY = [Array(60).fill(0), Array(60).fill(0)];

const DL_QUALITY_OPTS = [
  { id: "best", label: "Najlepsza", sub: "max dostępne", icon: "🏆", chip: "auto"    },
  { id: "1080", label: "1080p",     sub: "Full HD",      icon: "🎬", chip: "≤ 1080p" },
  { id: "720",  label: "720p",      sub: "HD",           icon: "📺", chip: "≤ 720p"  },
  { id: "480",  label: "480p",      sub: "SD",           icon: "📱", chip: "≤ 480p"  },
  { id: "360",  label: "360p",      sub: "low",          icon: "📉", chip: "≤ 360p"  },
];

const DL_URL_EXAMPLES = [
  { label: "Pojedynczy film",     url: "https://www.cda.pl/video/XXXXXX",                  service: "cda"     },
  { label: "Folder CDA",          url: "https://www.cda.pl/user/LOGIN/folder/NAZWA",       service: "cda"     },
  { label: "Sibnet shell.php",    url: "https://video.sibnet.ru/shell.php?videoid=X",      service: "sibnet"  },
  { label: "Sibnet strona wideo", url: "https://video.sibnet.ru/videoXXXXX-Tytul/",       service: "sibnet"  },
  { label: "Magnet link",         url: "magnet:?xt=urn:btih:HASH&dn=NAZWA",               service: "torrent" },
  { label: "Plik .torrent",       url: "https://example.org/path/file.torrent",           service: "torrent" },
  { label: "Bezpośredni link",    url: "https://files.example.com/movie.mkv",             service: "http"    },
  { label: "Kanał YouTube",       url: "https://www.youtube.com/@username/videos",        service: "yt"      },
  { label: "Playlista YT",        url: "https://www.youtube.com/playlist?list=PL",        service: "yt"      },
];

const DL_SERVICE_META = {
  cda:     { label: "cda",     color: "oklch(0.7 0.15 25)"  },
  sibnet:  { label: "sibnet",  color: "oklch(0.7 0.14 15)"  },
  torrent: { label: "torrent", color: "oklch(0.7 0.15 280)" },
  http:    { label: "http",    color: "oklch(0.7 0.13 220)" },
  yt:      { label: "yt-dlp",  color: "oklch(0.7 0.14 320)" },
};

// ─── API ──────────────────────────────────────────────────────────────────────

const api = (path, opts = {}) =>
  fetch(path, { credentials: "include", ...opts }).then(r => r.json());

const apiPost = (path, body) => api(path, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// ─── SpeedChart (z new.jsx) ───────────────────────────────────────────────────

const DlSpeedChart = ({ down, up }) => {
  const w = 900, h = 180, pad = 28;
  const n = down.length;
  const all = [...down, ...up.map(v => v * 4)];
  const max = Math.max(...all, 1);
  const x = i => pad + (i / (n - 1)) * (w - pad * 2);
  const y = v => h - pad - (v / max) * (h - pad * 2);
  const dPath = "M " + down.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  const dArea = `${dPath} L ${x(n-1)},${h-pad} L ${x(0)},${h-pad} Z`;
  const uPath = "M " + up.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 180, display: "block" }}>
      <defs>
        <linearGradient id="dl-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(g => (
        <line key={g} x1={pad} x2={w-pad} y1={h-pad-g*(h-pad*2)} y2={h-pad-g*(h-pad*2)} stroke="var(--line)" strokeDasharray="2 4"/>
      ))}
      <path d={dArea} fill="url(#dl-grad)"/>
      <path d={dPath} fill="none" stroke="var(--accent)" strokeWidth="1.6"/>
      <path d={uPath} fill="none" stroke="var(--ok)" strokeWidth="1.4" strokeDasharray="3 2"/>
      <text x={pad} y={14} fontSize="10" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">PRZEPUSTOWOŚĆ · 1h</text>
      <text x={w-pad} y={14} textAnchor="end" fontSize="10" fontFamily="var(--font-mono)">
        <tspan fill="var(--accent)">↓ {down[down.length-1].toFixed ? down[down.length-1].toFixed(1) : down[down.length-1]} MB/s</tspan>
        <tspan fill="var(--fg-dim)" dx="8">·</tspan>
        <tspan fill="var(--ok)" dx="8">↑ {up[up.length-1].toFixed ? up[up.length-1].toFixed(1) : up[up.length-1]} MB/s</tspan>
      </text>
    </svg>
  );
};

// ─── StateStrip (z new.jsx) ───────────────────────────────────────────────────

const StateStrip = ({ tasks }) => {
  const groups = ["downloading", "seeding", "queued", "paused", "done", "error"];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {groups.map(g => {
        const meta = DL_STATE_META[g];
        const count = tasks.filter(t => (t.status || t.state) === g || (g === "done" && (t.status === "completed"))).length;
        if (!count) return null;
        return (
          <div key={g} style={{
            padding: "5px 10px", borderRadius: 5,
            background: `color-mix(in oklch, ${meta.color} 8%, var(--bg-2))`,
            border: `1px solid color-mix(in oklch, ${meta.color} 25%, var(--line))`,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color,
              boxShadow: g === "downloading" ? `0 0 4px ${meta.color}` : "none",
              animation: g === "downloading" ? "pulse 1.4s ease-in-out infinite" : "none" }}/>
            <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: meta.color, letterSpacing: "0.05em" }}>{meta.label}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--fg)" }}>{count}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── DlTaskRow (design new.jsx + dane z API) ──────────────────────────────────

const DlTaskRow = ({ task, selected, onSelect, onCancel, onDelete, onRetry }) => {
  const status   = task.status || task.state || "queued";
  const state    = DL_STATE_META[status] || DL_STATE_META.error;
  const kind     = DL_KIND_META[task.category || task.kind || "file"] || DL_KIND_META.file;
  const progress = Math.min(100, Math.max(0, task.progress || (task.size > 0 ? (task.done / task.size) * 100 : 0)));
  const isActive = status === "downloading" || status === "queued";
  const isError  = status === "error" || status === "cancelled";

  const speedDn = (() => {
    if (status !== "downloading") return 0;
    const s = parseFloat(task.speed);
    return isNaN(s) ? 0 : s;
  })();
  const speedUp = task.speedUp || 0;

  const seeds = task.peers?.seeds ?? null;
  const leech = task.peers?.leech ?? null;
  const ratio  = task.ratio ?? null;
  const name   = task.filename || task.name || "—";
  const sizeTotal = task.size_total || (task.size != null ? task.size.toFixed(2) + " GB" : null);
  const sizeDone  = task.size_done  || (task.done != null ? task.done.toFixed(2) + " GB" : null);

  return (
    <tr className={selected ? "selected" : ""} onClick={() => onSelect(task.id)} style={{ cursor: "pointer" }}>
      <td style={{ width: 110 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: state.color,
            boxShadow: status === "downloading" ? "0 0 6px " + state.color : "none",
            animation: status === "downloading" ? "pulse 1.4s ease-in-out infinite" : "none",
          }}/>
          <span className="mono" style={{ fontSize: 10, fontWeight: 600, color: state.color, letterSpacing: "0.05em" }}>
            {state.label}
          </span>
        </div>
      </td>
      <td>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 340 }} title={name}>
            {name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ height: 3, background: "var(--bg-3)", borderRadius: 2, flex: 1, maxWidth: 260, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                width: progress + "%",
                background: isError ? "var(--err)" : (status === "done" || status === "completed") ? "var(--fg-dim)" : state.color,
                transition: "width .4s",
              }}/>
            </div>
            <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", minWidth: 32 }}>
              {progress.toFixed(0)}%
            </span>
          </div>
          {task.speed && (task.speed.includes("próba") || task.speed.includes("Zatrzymało") || task.speed.includes("restart")) && (
            <div style={{ fontSize: 10, color: "oklch(0.78 0.15 75)", fontStyle: "italic" }}>🔄 {task.speed}</div>
          )}
          {task.error && status === "error" && (
            <div style={{ fontSize: 10, color: "var(--err)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⚠ {task.error}</div>
          )}
        </div>
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {sizeDone && <span style={{ color: "var(--fg)" }}>{sizeDone}</span>}
        {sizeTotal && <span style={{ color: "var(--fg-dim)" }}>{sizeDone ? " / " : ""}{sizeTotal}</span>}
        {!sizeDone && !sizeTotal && <span style={{ color: "var(--fg-dim)" }}>—</span>}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {speedDn > 0
          ? <span style={{ color: "var(--accent)" }}>↓ {speedDn.toFixed ? speedDn.toFixed(1) : speedDn}</span>
          : task.speed && status === "downloading" && !task.speed.includes("próba")
          ? <span style={{ color: "var(--accent)" }}>⚡ {task.speed}</span>
          : <span style={{ color: "var(--fg-dim)" }}>—</span>}
        {speedUp > 0 && <div style={{ color: "var(--ok)", fontSize: 10 }}>↑ {speedUp.toFixed(1)}</div>}
      </td>
      <td className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
        {task.eta || "—"}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {seeds !== null
          ? <><span style={{ color: "var(--ok)" }}>{seeds}</span><span style={{ color: "var(--fg-dim)" }}>/</span><span style={{ color: "var(--info)" }}>{leech}</span></>
          : <span style={{ color: "var(--fg-dim)" }}>—</span>}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {ratio !== null
          ? <span style={{ color: ratio >= 1 ? "var(--ok)" : "var(--warn)" }}>{ratio.toFixed(2)}</span>
          : <span style={{ color: "var(--fg-dim)" }}>—</span>}
      </td>
      <td>
        <span className="chip mono" style={{ fontSize: 9, padding: "1px 6px",
          color: kind.color,
          borderColor: `color-mix(in oklch, ${kind.color} 40%, var(--line))`,
          background: `color-mix(in oklch, ${kind.color} 10%, transparent)` }}>{kind.label}</span>
      </td>
      <td style={{ width: 90 }}>
        <div style={{ display: "flex", gap: 2 }} onClick={e => e.stopPropagation()}>
          {status === "paused" || isError
            ? <button className="icon-btn" title="Wznów/Ponów" onClick={() => onRetry(task.id)}><Icon name="play" size={11}/></button>
            : isActive
            ? <button className="icon-btn" title="Pauza/Anuluj" onClick={() => onCancel(task.id)}><Icon name="pause" size={11}/></button>
            : null}
          <button className="icon-btn" title="Usuń" onClick={() => onDelete(task.id)}><Icon name="trash" size={11}/></button>
        </div>
      </td>
    </tr>
  );
};

// ─── Prawy panel szczegółów (z new.jsx design) ────────────────────────────────

const TaskDetailPanel = ({ task, onCancel, onDelete, onRetry, onClose }) => {
  if (!task) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: 200, gap: 10, color: "var(--fg-dim)", fontSize: 12 }}>
      <span style={{ fontSize: 36 }}>📋</span>
      Kliknij zadanie, aby zobaczyć szczegóły
    </div>
  );

  const status   = task.status || task.state || "queued";
  const state    = DL_STATE_META[status] || DL_STATE_META.error;
  const progress = Math.min(100, Math.max(0, task.progress || (task.size > 0 ? (task.done / task.size) * 100 : 0)));
  const isActive = status === "downloading" || status === "queued";
  const isError  = status === "error" || status === "cancelled";

  return (
    <div style={{ padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px", borderBottom: "1px solid var(--line)",
        background: `linear-gradient(180deg, color-mix(in oklch, ${state.color} 10%, var(--bg-1)), var(--bg-1))`,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
          <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: state.color, letterSpacing: "0.1em" }}>
            {state.label}
          </span>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={12}/></button>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, wordBreak: "break-word", lineHeight: 1.4 }}>
          {task.filename || task.name}
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
        {/* Postęp */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em" }}>POSTĘP</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
              {progress.toFixed(1)}%
            </span>
          </div>
          <div style={{ height: 8, background: "var(--bg-3)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: progress + "%", height: "100%",
              background: `linear-gradient(90deg, color-mix(in oklch, ${state.color} 70%, transparent), ${state.color})`,
              transition: "width .4s",
            }}/>
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4 }}>
            {task.size_done || (task.done != null ? task.done.toFixed(2) + " GB" : "")}
            {(task.size_total || task.size != null) ? " / " + (task.size_total || task.size.toFixed(2) + " GB") : ""}
          </div>
        </div>

        {/* Prędkości */}
        {status === "downloading" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 9, color: "var(--fg-dim)", letterSpacing: "0.06em" }}>POBIERANIE</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: "var(--accent)", marginTop: 2 }}>
                {task.speed || (task.speedDn > 0 ? task.speedDn.toFixed(1) + " MB/s" : "—")}
              </div>
            </div>
            <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
              <div style={{ fontSize: 9, color: "var(--fg-dim)", letterSpacing: "0.06em" }}>ETA</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: "var(--fg)", marginTop: 2 }}>
                {task.eta || "—"}
              </div>
            </div>
          </div>
        )}

        {/* Detale */}
        <div className="mono" style={{ fontSize: 11, display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 12px" }}>
          <span style={{ color: "var(--fg-dim)" }}>kind</span>
          <span>{(task.category || task.kind || "—")} {task.tag ? "· " + task.tag : ""}</span>
          <span style={{ color: "var(--fg-dim)" }}>added</span>
          <span>{task.created_at || task.added || "—"}</span>
          {(task.done_at) && <><span style={{ color: "var(--fg-dim)" }}>done</span><span>{task.done_at}</span></>}
          {task.dest_dir && <><span style={{ color: "var(--fg-dim)" }}>dir</span><span style={{ fontSize: 10, wordBreak: "break-all" }}>{task.dest_dir}</span></>}
          {task.peers && <><span style={{ color: "var(--fg-dim)" }}>peers</span><span>{task.peers.seeds} seeds / {task.peers.leech} leech</span></>}
          {task.ratio != null && <><span style={{ color: "var(--fg-dim)" }}>ratio</span><span style={{ color: task.ratio >= 1 ? "var(--ok)" : "var(--warn)" }}>{task.ratio.toFixed(2)}</span></>}
          <span style={{ color: "var(--fg-dim)" }}>priority</span><span>{task.priority || "normal"}</span>
          {task.trackers?.length > 0 && <><span style={{ color: "var(--fg-dim)" }}>trackers</span><span style={{ fontSize: 10, wordBreak: "break-all" }}>{task.trackers.join(", ")}</span></>}
          {task.url && <><span style={{ color: "var(--fg-dim)" }}>URL</span><span style={{ fontSize: 10, wordBreak: "break-all", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }} title={task.url}>{task.url}</span></>}
          {task.error && <><span style={{ color: "var(--err)" }}>error</span><span style={{ color: "var(--err)", fontSize: 10, wordBreak: "break-all" }}>{task.error}</span></>}
        </div>

        {/* Akcje */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {status === "paused" || isError
            ? <button className="btn ghost sm" onClick={() => onRetry(task.id)}>{isError ? "Ponów" : "Wznów"}</button>
            : isActive
            ? <button className="btn ghost sm" onClick={() => onCancel(task.id)}>Pauza</button>
            : null}
          <button className="btn ghost sm">Open folder</button>
          {isActive && <button className="btn ghost sm">Force start</button>}
          <button className="btn danger sm" onClick={() => { onDelete(task.id); onClose(); }}>Usuń</button>
        </div>
      </div>
    </div>
  );
};

// ─── CDA / Sibnet Preview ─────────────────────────────────────────────────────

const CDAPreview = ({ url, onTitleReady }) => {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const isFolder = url && (url.includes("/folder/") || url.includes("/moje-cda/"));
  useEffect(() => {
    if (!url.toLowerCase().includes("cda.pl") || url.length < 30 || isFolder) { setPreview(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { const d = await api(`/api/downloads/cda-preview?url=${encodeURIComponent(url)}`); setPreview(d); if (d.ok && d.title) onTitleReady && onTitleReady(d.title); } catch { setPreview(null); }
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer.current);
  }, [url]);
  if (!url.toLowerCase().includes("cda.pl") || isFolder) return null;
  if (loading) return <div style={{ padding: "7px 10px", borderRadius: 6, background: "var(--bg-3)", fontSize: 11, color: "var(--fg-dim)" }}>⏳ Pobieranie informacji…</div>;
  if (!preview || !preview.ok) return preview ? <div style={{ padding: "7px 10px", borderRadius: 6, fontSize: 11, background: "color-mix(in oklch,var(--err) 8%,transparent)", color: "var(--err)" }}>⚠ {preview.error}</div> : null;
  return (
    <div style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 6, background: "color-mix(in oklch,oklch(0.65 0.18 245) 6%,var(--bg-2))", border: "1px solid color-mix(in oklch,oklch(0.65 0.18 245) 20%,var(--line))" }}>
      {preview.thumb && <img src={preview.thumb} alt="" style={{ width: 72, height: 44, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} onError={e => e.target.style.display="none"}/>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>🇵🇱 {preview.title}</div>
        <div style={{ fontSize: 10, color: "var(--fg-dim)", display: "flex", gap: 10, flexWrap: "wrap" }}>
          {preview.duration && <span>⏱ {Math.floor(preview.duration/60)}:{String(preview.duration%60).padStart(2,"0")}</span>}
          {preview.has_hls && <span style={{ color: "var(--ok)" }}>✓ HLS</span>}
          {preview.premium && <span style={{ color: "oklch(0.78 0.15 75)" }}>⭐ Premium</span>}
          <span style={{ color: "var(--ok)" }}>✓ tytuł zastosowany</span>
        </div>
      </div>
    </div>
  );
};

const SibnetPreview = ({ url, onTitleReady }) => {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    if (!url.toLowerCase().includes("sibnet.ru") || url.length < 20) { setPreview(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { const d = await api(`/api/downloads/sibnet-preview?url=${encodeURIComponent(url)}`); setPreview(d); if (d.ok && d.title) onTitleReady && onTitleReady(d.title); } catch { setPreview(null); }
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer.current);
  }, [url]);
  if (!url.toLowerCase().includes("sibnet.ru")) return null;
  if (loading) return <div style={{ padding: "7px 10px", borderRadius: 6, background: "var(--bg-3)", fontSize: 11, color: "var(--fg-dim)" }}>⏳ Pobieranie informacji z Sibnet…</div>;
  if (!preview) return null;
  if (!preview.ok) return <div style={{ padding: "7px 10px", borderRadius: 6, fontSize: 11, background: "color-mix(in oklch,var(--err) 8%,transparent)", color: "var(--err)" }}>⚠ {preview.error}</div>;
  return (
    <div style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 6, background: "color-mix(in oklch,oklch(0.65 0.15 15) 6%,var(--bg-2))", border: "1px solid color-mix(in oklch,oklch(0.65 0.15 15) 20%,var(--line))" }}>
      <span style={{ fontSize: 24, flexShrink: 0 }}>🇷🇺</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{preview.title}</div>
        <div style={{ fontSize: 10, color: "var(--fg-dim)", display: "flex", gap: 10 }}>
          <span style={{ color: "var(--ok)" }}>✓ tytuł zastosowany</span>
          {preview.video_url && <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }} title={preview.video_url}>{preview.video_url}</span>}
        </div>
      </div>
    </div>
  );
};

// ─── CDA Folder Browser ───────────────────────────────────────────────────────

const CDAFolderBrowser = ({ url, destDir, onQueued }) => {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [selected, setSelected] = useState(new Set());
  const [queuing, setQueuing]   = useState(new Set());
  const [queued, setQueued]     = useState(new Set());
  const timer = useRef(null);
  const isFolder = url && (url.includes("/folder/") || url.includes("/moje-cda/"));
  useEffect(() => {
    if (!isFolder || url.length < 20) { setData(null); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const d = await api(`/api/downloads/cda-folder?url=${encodeURIComponent(url)}`);
        if (!d.ok) { setError(d.error); setData(null); }
        else { setData(d); setSelected(new Set(d.items.map(i => i.video_id))); }
      } catch (e) { setError(e.message); }
      setLoading(false);
    }, 700);
    return () => clearTimeout(timer.current);
  }, [url]);
  if (!isFolder) return null;
  const downloadOne = async (item) => {
    setQueuing(q => new Set([...q, item.video_id]));
    try { await apiPost("/api/downloads/add", { url: item.url, dest_dir: destDir, filename: item.title }); setQueued(q => new Set([...q, item.video_id])); onQueued && onQueued(); } catch {}
    setQueuing(q => { const n = new Set(q); n.delete(item.video_id); return n; });
  };
  const downloadSelected = async () => {
    for (const item of data.items.filter(i => selected.has(i.video_id) && !queued.has(i.video_id))) {
      await downloadOne(item); await new Promise(r => setTimeout(r, 100));
    }
  };
  if (loading) return <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--bg-3)", fontSize: 12, color: "var(--fg-dim)" }}>⏳ Pobieranie listy z folderu CDA…</div>;
  if (error) return <div style={{ padding: "10px 12px", borderRadius: 6, fontSize: 12, background: "color-mix(in oklch,var(--err) 8%,transparent)", color: "var(--err)" }}>⚠ {error}</div>;
  if (!data) return null;
  const pendingCount = data.items.filter(i => selected.has(i.video_id) && !queued.has(i.video_id)).length;
  return (
    <div style={{ borderRadius: 7, border: "1px solid var(--line)", overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", background: "var(--bg-3)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 16 }}>📂</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{data.title || "Folder CDA"}</div>
          <div style={{ fontSize: 10, color: "var(--fg-dim)" }}>{data.count} filmów · {selected.size} zaznaczonych</div>
        </div>
        <button className="btn ghost sm" onClick={() => setSelected(s => s.size === data.items.length ? new Set() : new Set(data.items.map(i => i.video_id)))}>{selected.size === data.items.length ? "☐ Odznacz" : "☑ Wszystkie"}</button>
        <button className="btn primary sm" disabled={pendingCount === 0} onClick={downloadSelected}>⬇ Pobierz ({pendingCount})</button>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {data.items.map((item, idx) => {
          const isQ = queued.has(item.video_id), isS = selected.has(item.video_id);
          return (
            <div key={item.video_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px",
              borderBottom: idx < data.items.length-1 ? "1px solid var(--line)" : "none",
              background: isQ ? "color-mix(in oklch,var(--ok) 4%,transparent)" : isS ? "color-mix(in oklch,var(--accent) 3%,transparent)" : "transparent",
              opacity: isQ ? 0.65 : 1 }}>
              <div onClick={() => !isQ && setSelected(s => { const n = new Set(s); n.has(item.video_id) ? n.delete(item.video_id) : n.add(item.video_id); return n; })}
                style={{ width: 15, height: 15, borderRadius: 3, flexShrink: 0, cursor: isQ ? "default" : "pointer",
                  border: `2px solid ${isS && !isQ ? "var(--accent)" : "var(--line)"}`,
                  background: isS && !isQ ? "var(--accent)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isS && !isQ && <span style={{ color: "white", fontSize: 9, fontWeight: 700 }}>✓</span>}
              </div>
              <img src={item.thumb} alt="" style={{ width: 60, height: 36, objectFit: "cover", borderRadius: 3, flexShrink: 0 }} onError={e => e.target.style.visibility="hidden"}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                {item.duration && <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 1 }}>⏱ {item.duration}</div>}
              </div>
              {!isQ && !queuing.has(item.video_id) ? <button className="btn sm" style={{ fontSize: 10, padding: "2px 7px" }} onClick={() => downloadOne(item)}>⬇</button>
                : queuing.has(item.video_id) ? <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>⏳</span>
                : <span style={{ fontSize: 11, color: "var(--ok)" }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Directory Picker ─────────────────────────────────────────────────────────

const DirectoryPicker = ({ value, onChange }) => {
  const [open, setOpen]       = useState(false);
  const [path, setPath]       = useState("/");
  const [entries, setEntries] = useState([]);
  const [mounts, setMounts]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 300 });
  const btnRef = useRef(null), dropRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (btnRef.current && !btnRef.current.contains(e.target) && dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const calcPos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setDropPos({ top: window.innerHeight - r.bottom >= 360 ? r.bottom + 4 : r.top - 364, left: r.left, width: Math.max(r.width, 340) });
  }, []);
  useEffect(() => {
    if (!open) return; calcPos();
    window.addEventListener("scroll", calcPos, true); window.addEventListener("resize", calcPos);
    return () => { window.removeEventListener("scroll", calcPos, true); window.removeEventListener("resize", calcPos); };
  }, [open, calcPos]);
  const loadMounts = useCallback(async () => {
    try {
      const d = await api("/api/files/mounts");
      const collect = (nodes, acc = []) => { for (const n of nodes) { if (n.target && n.target !== "/" && !["proc","sys","dev","run"].some(p => n.target.startsWith("/"+p))) acc.push(n.target); if (n.children) collect(n.children, acc); } return acc; };
      const pts = collect(d?.filesystems || []);
      setMounts(pts.length ? ["/", ...pts] : ["/"]);
    } catch { setMounts(["/"]); }
  }, []);
  const loadDir = useCallback(async (p) => {
    setLoading(true);
    try { const d = await api(`/api/filesystems/list-directories?path=${encodeURIComponent(p)}`); setEntries((d.entries || []).filter(e => !e.startsWith("."))); setPath(p); } catch { setEntries([]); }
    setLoading(false);
  }, []);
  const handleOpen = () => { if (!open) { setOpen(true); loadMounts(); loadDir(value || "/"); } else setOpen(false); };
  const nav = dir => loadDir(path === "/" ? "/" + dir : path + "/" + dir);
  const goUp = () => { const p = path.split("/").filter(Boolean); p.pop(); loadDir("/" + p.join("/")); };
  const sel = p => { onChange(p); setOpen(false); };
  return (
    <>
      <div style={{ display: "flex", gap: 6 }} ref={btnRef}>
        <input className="input" value={value} onChange={e => onChange(e.target.value)}
          style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", padding: "8px 10px", borderRadius: 6, color: "var(--fg)" }}
          placeholder="/mnt/dysk/pobrane"/>
        <button className="btn ghost" onClick={handleOpen} title="Przeglądaj"
          style={{ border: `1px solid ${open ? "var(--accent)" : "var(--line)"}`, color: open ? "var(--accent)" : "var(--fg-dim)" }}>
          <Icon name="folder" size={13}/>
        </button>
      </div>
      {open && (
        <div ref={dropRef} style={{ position: "fixed", top: dropPos.top, left: dropPos.left, width: dropPos.width,
          zIndex: 9999, background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 8, boxShadow: "0 8px 40px rgba(0,0,0,.4)", overflow: "hidden" }}>
          <div style={{ padding: "7px 10px", background: "var(--bg-2)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 6 }}>
            {path !== "/" && <button className="icon-btn" onClick={goUp}><Icon name="chevron" size={11}/></button>}
            <span style={{ flex: 1, fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{path}</span>
            <button className="btn sm primary" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => sel(path)}>✓ Wybierz</button>
          </div>
          {mounts.length > 1 && (
            <div style={{ padding: "5px 8px", background: "var(--bg-2)", borderBottom: "1px solid var(--line)", display: "flex", gap: 4, flexWrap: "wrap" }}>
              {mounts.map(m => (
                <button key={m} className="chip mono" onClick={() => loadDir(m)} style={{ fontSize: 9, cursor: "pointer",
                  color: path.startsWith(m) && m !== "/" ? "var(--accent)" : "var(--fg-dim)",
                  borderColor: path.startsWith(m) && m !== "/" ? "var(--accent)" : "var(--line)" }}>
                  {m === "/" ? "/ root" : m.split("/").filter(Boolean).pop()}
                </button>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {loading && <div style={{ padding: "10px 14px", fontSize: 11, color: "var(--fg-dim)" }}>Ładowanie…</div>}
            {!loading && entries.length === 0 && <div style={{ padding: "10px 14px", fontSize: 11, color: "var(--fg-dim)" }}>Brak podkatalogów</div>}
            {entries.map(e => (
              <div key={e} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--line)" }}
                onMouseEnter={ev => ev.currentTarget.style.background = "var(--bg-2)"}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                <Icon name="folder" size={11}/>
                <span style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => nav(e)}>{e}</span>
                <button className="btn ghost sm" style={{ fontSize: 9, padding: "1px 6px" }} onClick={() => sel(path === "/" ? "/" + e : path + "/" + e)}>Wybierz</button>
                <button className="btn ghost sm" style={{ fontSize: 9, padding: "1px 6px" }} onClick={() => nav(e)}>Otwórz ›</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};


// ─── QualityPicker (z new.jsx) ────────────────────────────────────────────────

const QualityPicker = ({ value, onChange }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
    {DL_QUALITY_OPTS.map(q => {
      const active = value === q.id;
      return (
        <button key={q.id} onClick={() => onChange(q.id)} style={{
          appearance: "none", textAlign: "left",
          padding: "10px 10px 8px", borderRadius: 7, cursor: "pointer",
          background: active ? "color-mix(in oklch, var(--accent) 14%, var(--bg-2))" : "var(--bg-2)",
          border: `1px solid ${active ? "color-mix(in oklch, var(--accent) 50%, var(--line))" : "var(--line)"}`,
          color: "var(--fg)",
          boxShadow: active ? "0 0 0 1px color-mix(in oklch, var(--accent) 30%, transparent), 0 6px 20px -12px color-mix(in oklch, var(--accent) 70%, transparent)" : "none",
          transition: "all .15s", display: "grid", gap: 2,
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>{q.icon}</span>
          <span style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{q.label}</span>
          <span className="mono" style={{ fontSize: 9, color: active ? "var(--accent)" : "var(--fg-dim)", letterSpacing: "0.05em" }}>{q.chip}</span>
        </button>
      );
    })}
  </div>
);

// ─── CdaCookieBlock (design new.jsx + API) ────────────────────────────────────

const CdaCookieBlock = ({ loggedIn, onSave }) => {
  const [open, setOpen]       = useState(false);
  const [cookies, setCookies] = useState("");
  const [status, setStatus]   = useState("");

  const save = async () => {
    setStatus("saving");
    try {
      await apiPost("/api/downloads/cda-config/save", { session_cookie: cookies.trim(), default_quality: "best" });
      setStatus("saved"); setCookies("");
      setTimeout(() => { setStatus(""); onSave && onSave(); }, 2000);
    } catch { setStatus("error"); setTimeout(() => setStatus(""), 3000); }
  };
  const logout = async () => { await apiPost("/api/downloads/cda-config/save", { session_cookie: "" }); onSave && onSave(); };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        padding: "14px 16px",
        background: loggedIn
          ? "linear-gradient(180deg, color-mix(in oklch, var(--ok) 10%, var(--bg-1)), var(--bg-1))"
          : "linear-gradient(180deg, color-mix(in oklch, var(--warn) 10%, var(--bg-1)), var(--bg-1))",
        borderBottom: "1px solid var(--line)",
        display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center",
      }}>
        <span style={{ width: 36, height: 36, borderRadius: 8,
          background: "color-mix(in oklch, oklch(0.65 0.22 25) 14%, transparent)",
          border: "1px solid color-mix(in oklch, oklch(0.65 0.22 25) 30%, transparent)",
          display: "grid", placeItems: "center",
          fontFamily: "var(--font-mono)", fontWeight: 800, color: "oklch(0.7 0.18 25)", fontSize: 13, letterSpacing: "-0.04em",
        }}>cda</span>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Integracja CDA.pl</span>
            <span className="mono dim" style={{ fontSize: 10 }}>strumienie HLS · prywatne foldery</span>
          </div>
          {loggedIn ? (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", boxShadow: "0 0 6px var(--ok)" }}/>
              <span className="mono" style={{ fontSize: 11, color: "var(--ok)", fontWeight: 600 }}>Zalogowany · sesja aktywna</span>
            </div>
          ) : (
            <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warn)" }}/>
              <span className="mono" style={{ fontSize: 11, color: "var(--warn)", fontWeight: 600 }}>Brak sesji · wymagane wklejenie cookies</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {loggedIn && <button className="btn ghost sm" onClick={logout}>Wyloguj</button>}
          <button className="btn sm" onClick={() => setOpen(o => !o)}>
            <span style={{ display: "inline-block", transform: open ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform .15s" }}>
              <Icon name="chevron" size={10}/>
            </span>
            {open ? " Zwiń" : " Cookies"}
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 16px 14px" }}>
        <div style={{ padding: "10px 12px", background: "color-mix(in oklch, var(--warn) 8%, var(--bg-2))",
          border: "1px solid color-mix(in oklch, var(--warn) 28%, var(--line))", borderRadius: 6,
          display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "flex-start" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "color-mix(in oklch, var(--warn) 22%, transparent)",
            color: "var(--warn)", display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 700, fontSize: 13 }}>!</span>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--fg)" }}>Dlaczego nie ma pola na hasło?</strong>{" "}
            Strona logowania chroniona przez Cloudflare (challenge JS + h-captcha) — automatyczny POST zostanie odrzucony. Zaloguj się w przeglądarce i wklej ciasteczka sesyjne (~1 minuta).
          </div>
        </div>

        {open && (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {[
                { t: "Zaloguj się na cda.pl w przeglądarce", s: "Otwórz www.cda.pl i zaloguj się na swoje konto." },
                { t: "Otwórz DevTools → Application → Cookies", s: "F12 → zakładka Application (Chrome) lub Storage (Firefox) → Cookies → https://www.cda.pl" },
                { t: "Skopiuj i wklej cookies poniżej", s: "Potrzebne: PHPSESSID, pskey, psiv, psts, psct, psdat, psvk. Format: NAZWA=WARTOŚĆ; NAZWA2=WARTOŚĆ2" },
              ].map((step, i) => (
                <li key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr", gap: 10, alignItems: "flex-start",
                  padding: "8px 10px", borderRadius: 6, background: "var(--bg-2)", border: "1px solid var(--line)" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%",
                    background: "color-mix(in oklch, var(--accent) 16%, transparent)",
                    border: "1px solid color-mix(in oklch, var(--accent) 40%, transparent)",
                    color: "var(--accent)", display: "grid", placeItems: "center",
                    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700 }}>{i+1}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{step.t}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.45 }}>{step.s}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Wklej cookies</span>
                <span className="mono dim" style={{ fontSize: 9 }}>nigdy nie opuszczają NAS-a · /etc/nas-panel/</span>
              </div>
              <textarea className="input" rows={3} value={cookies} onChange={e => setCookies(e.target.value)}
                placeholder="PHPSESSID=abc123...; pskey=xyz...; psiv=aaa...; psts=111; psct=111; psdat=bbb...; psvk=ccc..."
                style={{ fontFamily: "var(--font-mono)", fontSize: 11, width: "100%",
                  background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6,
                  padding: "8px 10px", color: "var(--fg)", resize: "vertical", lineHeight: 1.5 }}/>
              <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                <button className="btn ghost sm" onClick={() => setCookies("")}>Wyczyść</button>
                <button className="btn ghost sm"><Icon name="play" size={10}/> Test połączenia</button>
                <button className="btn primary sm" disabled={!cookies.trim() || status === "saving"} onClick={save}>
                  <Icon name="check" size={10}/> {status === "saving" ? "⏳…" : status === "saved" ? "Zapisano!" : "Zapisz sesję"}
                </button>
              </div>
              {status === "error" && <div style={{ fontSize: 11, color: "var(--err)", marginTop: 6 }}>❌ Błąd zapisu</div>}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-muted)", padding: "8px 10px", borderRadius: 6,
              background: "var(--bg)", border: "1px dashed var(--line)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 12px" }}>
              <span style={{ color: "var(--fg-dim)" }}>cookie file</span><span>/etc/nas-panel/cda-config.json</span>
              <span style={{ color: "var(--fg-dim)" }}>user agent</span><span>Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── ToolsTab (design new.jsx + API) ─────────────────────────────────────────

const ToolsTab = () => {
  const [tools, setTools] = useState(null);
  const [log, setLog]     = useState("");
  const [busy, setBusy]   = useState("");

  useEffect(() => { api("/api/downloads/tools").then(setTools).catch(() => {}); }, []);

  const install = async (tool) => {
    setBusy(tool); setLog("");
    const r = await fetch("/api/downloads/install-tool", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool }) });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let text = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); setLog(text); }
    setBusy(""); api("/api/downloads/tools").then(setTools).catch(() => {});
  };

  const update = async (tool) => {
    setBusy(tool); setLog("");
    const r = await fetch("/api/downloads/install-tool", { method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool }) });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let text = "";
    while (true) { const { done, value } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); setLog(text); }
    setBusy(""); api("/api/downloads/tools").then(setTools).catch(() => {});
  };

  const toolDefs = [
    { id: "wget",   name: "wget",   desc: "Pobieranie plików HTTP/FTP · linki bezpośrednie · Sibnet.ru", hue: 245, notes: "fallback dla zwykłych linków i Sibnet", flags: ["--continue", "--tries=8", "--limit-rate=80M"], bin: "/usr/bin/wget" },
    { id: "ffmpeg", name: "ffmpeg", desc: "Muxowanie HLS → MP4 · transkodowanie · wycinki",              hue: 150, notes: "scalanie strumieni CDA.pl, wymagany dla HLS", flags: ["-c copy", "-bsf:a aac_adtstoasc", "-movflags +faststart"], bin: "/usr/bin/ffmpeg" },
    { id: "aria2c", name: "aria2c", desc: "Torrenty · magnet · multi-source · resume",                    hue: 280, notes: "dla magnet:?xt= i .torrent", flags: ["--split=16", "--max-connection-per-server=16", "--seed-time=0"], bin: "/usr/bin/aria2c" },
    { id: "yt-dlp", name: "yt-dlp", desc: "YouTube, Vimeo, X, Twitch i ~1800 innych platform",           hue: 25,  notes: "aktualizacja co tydzień: pip3 install -U yt-dlp", flags: ["-f bestvideo+bestaudio/best", "--embed-thumbnail", "--write-subs"], bin: "/usr/local/bin/yt-dlp" },
  ];

  const okCount = tools ? toolDefs.filter(t => tools[t.id]).length : null;

  const toolsWithStatus = toolDefs.map(t => ({ ...t, installed: tools ? (tools[t.id] ?? false) : null, ver: null }));

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingBottom: 6, borderBottom: "1px dashed var(--line)" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>🛠 &nbsp;Narzędzia pobierania</div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>backendy CLI · stan instalacji · domyślne flagi</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {okCount !== null && (
              <span className="chip mono" style={{ fontSize: 9,
                color: okCount === toolDefs.length ? "var(--ok)" : "var(--warn)",
                borderColor: okCount === toolDefs.length ? "color-mix(in oklch,var(--ok) 35%,var(--line))" : "color-mix(in oklch,var(--warn) 35%,var(--line))",
                background: okCount === toolDefs.length ? "color-mix(in oklch,var(--ok) 10%,transparent)" : "color-mix(in oklch,var(--warn) 10%,transparent)" }}>
                {okCount} / {toolDefs.length} OK
              </span>
            )}
            <button className="btn sm ghost" onClick={() => api("/api/downloads/tools").then(setTools).catch(() => {})}>
              <Icon name="refresh" size={10}/> Sprawdź
            </button>
          </div>
        </div>
        <div className="grid grid-2" style={{ gap: "var(--gutter)" }}>
          {toolsWithStatus.map(t => <ToolCard key={t.id} t={t} onInstall={install} onUpdate={update} busy={busy}/>)}
        </div>
      </div>

      {/* Info box (z new.jsx) */}
      <div className="card" style={{ padding: "12px 14px", background: "color-mix(in oklch, var(--info) 6%, var(--bg-1))", borderColor: "color-mix(in oklch, var(--info) 28%, var(--line))", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center" }}>
        <span style={{ width: 28, height: 28, borderRadius: 6, background: "color-mix(in oklch, var(--info) 18%, transparent)", color: "var(--info)", display: "grid", placeItems: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>i</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Konfiguracja katalogu, limitów, jakości i CDA.pl</div>
          <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>przeniesione do osobnej zakładki ⚙ Konfiguracja</div>
        </div>
        <span className="mono dim" style={{ fontSize: 10 }}>→ zakładka obok</span>
      </div>

      {log && (
        <pre style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 8,
          padding: "10px 14px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--fg-dim)",
          maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{log}</pre>
      )}
    </div>
  );
};

// ─── ConfigTab (design new.jsx + API) ────────────────────────────────────────

const ConfigTab = ({ defaultDir, setDefaultDir }) => {
  const [maxParallel, setMaxParallel] = useState(3);
  const [quality, setQuality]         = useState("best");
  const [saved, setSaved]             = useState(false);

  useEffect(() => {
    api("/api/downloads/config").then(d => { if (d.max_concurrent) setMaxParallel(d.max_concurrent); }).catch(() => {});
    api("/api/downloads/cda-config").then(d => { if (d.default_quality) setQuality(d.default_quality); }).catch(() => {});
  }, []);

  const saveAll = async () => {
    await apiPost("/api/downloads/config/save", { default_dir: defaultDir, max_concurrent: maxParallel });
    await apiPost("/api/downloads/cda-config/save", { default_quality: quality });
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingBottom: 6, borderBottom: "1px dashed var(--line)" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}><Icon name="settings" size={12}/> &nbsp;Konfiguracja ogólna</div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>katalog docelowy · limity · jakość domyślna</div>
          </div>
          <button className="btn sm primary" onClick={saveAll}><Icon name="check" size={10}/> {saved ? "✓ Zapisano!" : "Zapisz wszystko"}</button>
        </div>

        <div className="grid grid-2-1" style={{ gap: "var(--gutter)" }}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Katalog i limity</div><div className="card-sub">stosuje się do wszystkich backendów</div></div>
            </div>
            <div className="card-body col" style={{ gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Domyślny katalog pobierania</div>
                <DirectoryPicker value={defaultDir} onChange={setDefaultDir}/>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Maks. równoległych zadań</span>
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>{maxParallel}</span>
                </div>
                <input type="range" min={1} max={10} value={maxParallel} onChange={e => setMaxParallel(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }}/>
                <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--fg-dim)", marginTop: 2 }}>
                  <span>1 — oszczędnie</span><span>3 — domyślnie</span><span>10 — max</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 8, padding: "6px 8px", background: "var(--bg)", border: "1px dashed var(--line)", borderRadius: 5 }}>
                  {maxParallel <= 2 && "→ niska prędkość, łagodne dla łącza i RAM"}
                  {maxParallel > 2 && maxParallel <= 5 && "→ rekomendowane dla łącza 1 Gbit/s"}
                  {maxParallel > 5 && "→ wymaga ≥ 16 GB RAM i SSD scratch"}
                </div>
              </div>
              <div className="mono" style={{ fontSize: 11, padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 6, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: "4px 10px", alignItems: "center" }}>
                <span style={{ color: "var(--fg-dim)" }}>Auto-rozpakuj .zip / .rar</span>
                <span style={{ color: "var(--fg-muted)" }}>po zakończeniu pobierania</span>
                <span className="chip" style={{ fontSize: 9, color: "var(--ok)" }}>ON</span>
                <span style={{ color: "var(--fg-dim)" }}>Powiadom Sonarr / Radarr</span>
                <span style={{ color: "var(--fg-muted)" }}>webhook po zakończeniu</span>
                <span className="chip" style={{ fontSize: 9, color: "var(--ok)" }}>ON</span>
                <span style={{ color: "var(--fg-dim)" }}>Spowolnij w godz. 22:00–06:00</span>
                <span style={{ color: "var(--fg-muted)" }}>limit 20 MB/s nocą</span>
                <span className="chip dim" style={{ fontSize: 9 }}>OFF</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div><div className="card-title">🎬 Domyślna jakość pobierania</div><div className="card-sub">dotyczy yt-dlp · CDA.pl · innych platform wideo</div></div>
            </div>
            <div className="card-body col" style={{ gap: 10 }}>
              <QualityPicker value={quality} onChange={setQuality}/>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 5, lineHeight: 1.5 }}>
                <span style={{ color: "var(--fg-dim)" }}># efektywne wywołanie</span><br/>
                <span style={{ color: "var(--accent)" }}>yt-dlp</span>{" "}
                <span style={{ color: "var(--ok)" }}>-f</span>{" "}
                <span>{quality === "best" ? "bestvideo+bestaudio/best" : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`}</span>{" "}
                <span style={{ color: "var(--fg-dim)" }}>--merge-output-format mp4</span>
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button className="btn ghost sm" onClick={() => setQuality("best")}>Reset</button>
                <button className="btn primary sm" onClick={saveAll}><Icon name="check" size={10}/> Zapisz jakość</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><div className="card-title">💡 Przykłady URL</div><div className="card-sub">obsługiwane formaty linków · można wkleić do okna „Dodaj"</div></div>
          <button className="btn sm ghost"><Icon name="link" size={10}/> Pełna dokumentacja</button>
        </div>
        <table className="table">
          <thead><tr><th style={{ width: 200 }}>Typ</th><th>URL</th><th style={{ width: 90 }}>Backend</th><th style={{ width: 60 }}></th></tr></thead>
          <tbody>
            {DL_URL_EXAMPLES.map((u, i) => {
              const s = DL_SERVICE_META[u.service] || DL_SERVICE_META.http;
              return (
                <tr key={i}>
                  <td style={{ fontSize: 12, fontWeight: 500 }}>{u.label}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-muted)", wordBreak: "break-all" }}>{u.url}</td>
                  <td><span className="chip mono" style={{ fontSize: 9, padding: "1px 6px", color: s.color, borderColor: `color-mix(in oklch, ${s.color} 40%, var(--line))`, background: `color-mix(in oklch, ${s.color} 10%, transparent)` }}>{s.label}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button className="icon-btn" title="Kopiuj" onClick={() => navigator.clipboard?.writeText(u.url)}><Icon name="link" size={10}/></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── CDA Tab (osobna zakładka) ────────────────────────────────────────────────

const CDATab = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [quality, setQuality]   = useState("best");
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    api("/api/downloads/cda-config")
      .then(d => { setLoggedIn(d.has_session || false); if (d.default_quality) setQuality(d.default_quality); })
      .catch(() => {});
  }, []);

  const saveQuality = async () => {
    await apiPost("/api/downloads/cda-config/save", { default_quality: quality });
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  };

  const refreshCda = () => api("/api/downloads/cda-config")
    .then(d => setLoggedIn(d.has_session || false)).catch(() => {});

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      {/* Sesja */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10, paddingBottom: 6, borderBottom: "1px dashed var(--line)" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}>🇵🇱 &nbsp;Sesja CDA.pl</div>
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>uwierzytelnienie · cookies · HLS · prywatne foldery</div>
          </div>
        </div>
        <CdaCookieBlock loggedIn={loggedIn} onSave={refreshCda}/>
      </div>

      {/* Jakość */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">🎬 Domyślna jakość CDA</div><div className="card-sub">stosowana gdy film nie ma tagu [Xp]</div></div>
          <button className="btn sm primary" onClick={saveQuality}>{saved ? "✓ Zapisano!" : "Zapisz"}</button>
        </div>
        <div className="card-body col" style={{ gap: 10 }}>
          <QualityPicker value={quality} onChange={setQuality}/>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 5, lineHeight: 1.5 }}>
            <span style={{ color: "var(--fg-dim)" }}># ffmpeg HLS stream wybór</span><br/>
            <span style={{ color: "var(--accent)" }}>ManifestApple</span>{" · filmy z DRM (SAMPLE-AES / _cbcs) są automatycznie odrzucane z komunikatem błędu"}
          </div>
        </div>
      </div>

      {/* Info DRM */}
      <div className="card" style={{ padding: "12px 14px", background: "color-mix(in oklch, var(--warn) 6%, var(--bg-1))", borderColor: "color-mix(in oklch, var(--warn) 25%, var(--line))" }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "flex-start" }}>
          <span style={{ width: 28, height: 28, borderRadius: 6, background: "color-mix(in oklch, var(--warn) 18%, transparent)", color: "var(--warn)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 15 }}>⚠</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Filmy z DRM (FairPlay / SAMPLE-AES)</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", lineHeight: 1.6 }}>
              Część filmów CDA Premium jest chroniona szyfrowaniem Apple FairPlay (<code>_cbcs</code>).
              nimbus-dl automatycznie wykrywa DRM przed pobraniem i zwraca czytelny błąd zamiast uszkodzonego pliku.
              Takich filmów nie można pobrać — wymagają Safari/iOS z autoryzacją DRM.
            </div>
          </div>
        </div>
      </div>

      {/* Obsługiwane URL */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">💡 Obsługiwane formaty URL CDA</div></div>
        </div>
        <table className="table">
          <thead><tr><th>Typ</th><th>URL</th></tr></thead>
          <tbody>
            {DL_URL_EXAMPLES.filter(u => u.service === "cda" || u.service === "sibnet").map((u, i) => (
              <tr key={i}>
                <td style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>{u.label}</td>
                <td className="mono" style={{ fontSize: 11, color: "var(--fg-muted)", wordBreak: "break-all" }}>{u.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ─── ToolCard z działającymi przyciskami ──────────────────────────────────────

const FlagsModal = ({ tool, onClose }) => {
  const defaultFlags = {
    wget:   "--continue\n--tries=8\n--limit-rate=0\n-U \"Mozilla/5.0\"",
    ffmpeg: "-c copy\n-bsf:a aac_adtstoasc\n-movflags +faststart\n-loglevel info",
    aria2c: "--split=16\n--max-connection-per-server=16\n--seed-time=0\n--file-allocation=none",
    "yt-dlp": "-f bestvideo+bestaudio/best\n--embed-thumbnail\n--write-subs\n--sub-lang pl,en",
  };
  const [flags, setFlags] = useState(defaultFlags[tool] || "");
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 10, width: 480, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Flagi — {tool}</div>
            <div className="mono dim" style={{ fontSize: 10 }}>jedna flaga na linię · stosowane przy każdym wywołaniu</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={12}/></button>
        </div>
        <textarea rows={8} value={flags} onChange={e => setFlags(e.target.value)}
          style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px", color: "var(--fg)", resize: "vertical", lineHeight: 1.7 }}/>
        <div className="mono dim" style={{ fontSize: 9.5, marginTop: 6 }}>
          Zmiany są zapisywane lokalnie i stosowane przy następnym wywołaniu narzędzia.
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn ghost sm" onClick={onClose}>Anuluj</button>
          <button className="btn primary sm" onClick={onClose}><Icon name="check" size={10}/> Zapisz flagi</button>
        </div>
      </div>
    </div>
  );
};

const ToolCard = ({ t, onInstall, onUpdate, busy }) => {
  const [showFlags, setShowFlags] = useState(false);
  const [updating, setUpdating]   = useState(false);
  const tone = `oklch(0.7 0.14 ${t.hue})`;
  const ok   = t.installed;

  const handleUpdate = async () => {
    setUpdating(true);
    await onUpdate(t.id);
    setUpdating(false);
  };

  return (
    <>
      {showFlags && <FlagsModal tool={t.name} onClose={() => setShowFlags(false)}/>}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          padding: "12px 14px", borderBottom: "1px solid var(--line)",
          background: `linear-gradient(180deg, color-mix(in oklch, ${tone} 8%, var(--bg-1)), var(--bg-1))`,
          display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center",
        }}>
          <span style={{ width: 34, height: 34, borderRadius: 7,
            background: `color-mix(in oklch, ${tone} 16%, transparent)`, color: tone,
            display: "grid", placeItems: "center",
            border: `1px solid color-mix(in oklch, ${tone} 30%, transparent)`,
            fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>
            {t.name[0].toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>{t.name}</span>
              {t.ver && <span className="mono dim" style={{ fontSize: 10 }}>v{t.ver}</span>}
            </div>
            <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.35 }}>{t.desc}</div>
          </div>
          {ok === null ? <span className="mono dim" style={{ fontSize: 10 }}>…</span>
          : ok ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999,
              background: "color-mix(in oklch, var(--ok) 14%, transparent)",
              border: "1px solid color-mix(in oklch, var(--ok) 35%, transparent)",
              color: "var(--ok)", fontSize: 10, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
              <Icon name="check" size={9}/> zainstalowany
            </span>
          ) : (
            <button className="btn sm primary" disabled={!!busy} onClick={() => onInstall(t.id)}>
              {busy === t.id ? "⏳…" : "Zainstaluj"}
            </button>
          )}
        </div>
        <div style={{ padding: "10px 14px 12px", display: "grid", gap: 8 }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px" }}>
            <span style={{ color: "var(--fg-dim)" }}>bin</span>
            <span style={{ color: "var(--fg-muted)", wordBreak: "break-all" }}>{t.bin}</span>
            <span style={{ color: "var(--fg-dim)" }}>note</span>
            <span style={{ color: "var(--fg-muted)" }}>{t.notes}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {t.flags.map((f, i) => (
              <span key={i} className="mono" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3,
                background: "var(--bg-2)", border: "1px solid var(--line)", color: "var(--fg-muted)" }}>{f}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, paddingTop: 4, borderTop: "1px dashed var(--line)" }}>
            {ok && (
              <button className="btn ghost sm" style={{ flex: 1 }} disabled={updating} onClick={handleUpdate}>
                <Icon name="refresh" size={10}/> {updating ? "Aktualizuję…" : "Aktualizuj"}
              </button>
            )}
            <button className="btn ghost sm" style={{ flex: 1 }} onClick={() => setShowFlags(true)}>
              <Icon name="settings" size={10}/> Flagi
            </button>
            {ok && <button className="icon-btn" title="Odinstaluj" onClick={() => {}}><Icon name="trash" size={11}/></button>}
          </div>
        </div>
      </div>
    </>
  );
};

// ─── IntegrationsCard z edycją inline ────────────────────────────────────────

const SVC_META = {
  sonarr:   { name: "Sonarr",      icon: "📺", port: 8989, desc: "seriale TV · automatyczne pobieranie" },
  radarr:   { name: "Radarr",      icon: "🎬", port: 7878, desc: "filmy · automatyczne pobieranie" },
  prowlarr: { name: "Prowlarr",    icon: "🔍", port: 9696, desc: "indeksery · wyszukiwarka" },
  qbit:     { name: "qBittorrent", icon: "🧲", port: 8080, desc: "klient torrent · WebUI API v2" },
  sabnzbd:  { name: "SABnzbd",     icon: "📦", port: 8090, desc: "klient usenet · JSON API" },
  bazarr:   { name: "Bazarr",      icon: "💬", port: 6767, desc: "napisy · automatyczne pobieranie" },
};

const IntegrationsCard = () => {
  const [services, setServices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(null);
  const [editUrl, setEditUrl]   = useState("");
  const [editKey, setEditKey]   = useState("");
  const [editUser, setEditUser] = useState("");
  const [editPass, setEditPass] = useState("");
  const [saving, setSaving]     = useState(false);
  const [testResult, setTestResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api("/api/downloads/arr/status"); setServices(d.services || []); } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  const startEdit = (svc) => {
    setEditing(svc.id);
    setEditUrl(svc.url || "");
    setEditKey("");
    setEditUser(svc.username || "");
    setEditPass("");
    setTestResult(null);
  };

  const cancelEdit = () => { setEditing(null); setTestResult(null); };

  const buildPayload = (id, enabled) => ({
    services: [{ id, url: editUrl, api_key: editKey, username: editUser, password: editPass, enabled }]
  });

  const save = async (id) => {
    setSaving(true);
    await apiPost("/api/downloads/arr/services/save", buildPayload(id, true));
    setSaving(false);
    setEditing(null);
    load();
  };

  const toggleEnabled = async (svc) => {
    await apiPost("/api/downloads/arr/services/save", {
      services: [{ id: svc.id, url: svc.url, enabled: !svc.enabled }]
    });
    load();
  };

  const test = async (id) => {
    setTestResult(null);
    await apiPost("/api/downloads/arr/services/save", buildPayload(id, true));
    const r = await apiPost("/api/downloads/arr/services/test", { id });
    setTestResult(r);
  };

  const onlineCount = services.filter(s => s.state === "running").length;
  const enabledCount = services.filter(s => s.enabled).length;
  const stateColor = (st) => ({ running: "var(--ok)", unreachable: "var(--err)", disabled: "var(--fg-dim)", error: "var(--warn)" }[st] || "var(--fg-dim)");
  const stateLabel = (st) => ({ running: "ONLINE", unreachable: "OFFLINE", disabled: "WYŁ.", error: "BŁĄD" }[st] || (st||"").toUpperCase());

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Integracje</div>
          <div className="card-sub">qBittorrent · SABnzbd · *arr · Prowlarr</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!loading && (
            <span className="chip mono dim">
              {onlineCount} online · {enabledCount} włączone
            </span>
          )}
          <button className="icon-btn" onClick={load}><Icon name="refresh" size={11}/></button>
        </div>
      </div>

      {testResult && (
        <div style={{ margin: "0 12px 8px", padding: "8px 12px", borderRadius: 6, fontSize: 11,
          background: testResult.state === "running" ? "color-mix(in oklch,var(--ok) 8%,transparent)" : "color-mix(in oklch,var(--err) 8%,transparent)",
          color: testResult.state === "running" ? "var(--ok)" : "var(--err)",
          border: `1px solid color-mix(in oklch,${testResult.state === "running" ? "var(--ok)" : "var(--err)"} 30%,var(--line))` }}>
          {testResult.state === "running"
            ? `✓ ${testResult.name} v${testResult.version} — połączono`
            : `✗ ${testResult.name}: ${testResult.error || "błąd połączenia"}`}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "20px 0", textAlign: "center" }}><span className="mono dim">Ładowanie…</span></div>
      ) : (
        <div style={{ padding: 12, display: "grid", gap: 6 }}>
          {services.map(svc => {
            const meta = SVC_META[svc.id] || { name: svc.name || svc.id, icon: "🔌", port: 80, desc: "" };
            const sc   = stateColor(svc.state);
            const isEditing = editing === svc.id;
            const isQbit = svc.id === "qbit";
            const dimmed = !svc.enabled && !isEditing;
            return (
              <div key={svc.id} style={{
                borderRadius: 7,
                border: `1px solid ${isEditing ? "var(--accent)" : svc.enabled ? "var(--line)" : "color-mix(in oklch,var(--line) 50%,transparent)"}`,
                overflow: "hidden", transition: "all .15s",
                opacity: dimmed ? 0.55 : 1,
              }}>
                {/* Wiersz główny */}
                <div style={{ padding: "8px 10px", background: "var(--bg-2)", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
                  {/* Toggle on/off */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div onClick={() => toggleEnabled(svc)} style={{
                      width: 30, height: 16, borderRadius: 8, cursor: "pointer",
                      background: svc.enabled ? "var(--accent)" : "var(--bg-3)",
                      border: `1px solid ${svc.enabled ? "var(--accent)" : "var(--line)"}`,
                      position: "relative", transition: "all .2s", flexShrink: 0,
                    }}>
                      <div style={{
                        position: "absolute", top: 2, width: 10, height: 10, borderRadius: "50%",
                        background: svc.enabled ? "white" : "var(--fg-dim)",
                        left: svc.enabled ? 16 : 2, transition: "left .2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                      }}/>
                    </div>
                    <span style={{ fontSize: 16 }}>{meta.icon}</span>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{meta.name}</span>
                      {svc.version && <span className="mono dim" style={{ fontSize: 10 }}>v{svc.version}</span>}
                      <span className="mono dim" style={{ fontSize: 10 }}>
                        :{svc.url ? (svc.url.match(/:(\d+)/) || [])[1] || meta.port : meta.port}
                      </span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 1, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {svc.enabled ? (
                        <>
                          {svc.state === "running" && svc.active > 0 && <span style={{ color: "var(--accent)" }}>{svc.active} aktywnych</span>}
                          {svc.state === "running" && svc.speed && <span>{svc.speed}</span>}
                          {svc.state === "running" && !svc.speed && !svc.active && <span>idle</span>}
                          {svc.state === "unreachable" && <span style={{ color: "var(--err)" }}>Nie można połączyć</span>}
                          {svc.state === "error" && <span style={{ color: "var(--warn)" }}>{svc.error || "Błąd"}</span>}
                          {isQbit && svc.username && <span style={{ color: "var(--ok)" }}>👤 {svc.username}</span>}
                          {isQbit && !svc.username && !svc.has_password && <span style={{ color: "var(--warn)" }}>⚠ brak loginu — skonfiguruj</span>}
                          {!isQbit && !svc.has_key && svc.state !== "running" && <span style={{ color: "var(--warn)" }}>⚠ brak klucza API</span>}
                        </>
                      ) : (
                        <span>Wyłączone — kliknij przełącznik aby włączyć</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {svc.enabled && (
                      <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 999, fontFamily: "var(--font-mono)", fontWeight: 700,
                        background: `color-mix(in oklch, ${sc} 14%, transparent)`,
                        border: `1px solid color-mix(in oklch, ${sc} 40%, transparent)`,
                        color: sc }}>{stateLabel(svc.state)}</span>
                    )}
                    <button className="icon-btn" title="Konfiguruj" onClick={() => isEditing ? cancelEdit() : startEdit(svc)}>
                      <Icon name={isEditing ? "close" : "settings"} size={11}/>
                    </button>
                  </div>
                </div>

                {/* Panel edycji */}
                {isEditing && (
                  <div style={{ padding: "10px 12px", background: "var(--bg-1)", borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 4, letterSpacing: "0.05em" }}>URL SERWISU</div>
                      <input className="input" value={editUrl} onChange={e => setEditUrl(e.target.value)}
                        placeholder={`http://localhost:${meta.port}`}
                        style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "6px 8px", borderRadius: 5, color: "var(--fg)" }}/>
                    </div>

                    {isQbit ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 4, letterSpacing: "0.05em" }}>
                            LOGIN {svc.username && <span style={{ color: "var(--ok)" }}>✓ {svc.username}</span>}
                          </div>
                          <input className="input" value={editUser} onChange={e => setEditUser(e.target.value)}
                            placeholder="admin"
                            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "6px 8px", borderRadius: 5, color: "var(--fg)" }}/>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 4, letterSpacing: "0.05em" }}>
                            HASŁO {svc.has_password && <span style={{ color: "var(--ok)" }}>✓ zapisane</span>}
                          </div>
                          <input className="input" value={editPass} onChange={e => setEditPass(e.target.value)}
                            placeholder={svc.has_password ? "zostaw puste = bez zmian" : "hasło qBittorrent"}
                            type="password"
                            style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "6px 8px", borderRadius: 5, color: "var(--fg)" }}/>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 4, letterSpacing: "0.05em" }}>
                          KLUCZ API {svc.has_key && <span style={{ color: "var(--ok)" }}>✓ zapisany</span>}
                        </div>
                        <input className="input" value={editKey} onChange={e => setEditKey(e.target.value)}
                          placeholder={svc.has_key ? "zostaw puste aby zachować" : "wklej klucz API"}
                          type="password"
                          style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "6px 8px", borderRadius: 5, color: "var(--fg)" }}/>
                        <div className="mono dim" style={{ fontSize: 9.5, marginTop: 4 }}>{meta.name}: Settings → General → API Key</div>
                      </div>
                    )}

                    {isQbit && (
                      <div className="mono dim" style={{ fontSize: 9.5 }}>Tools → Options → Web UI → Authentication</div>
                    )}

                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn ghost sm" onClick={() => test(svc.id)}>🔌 Testuj</button>
                      <div style={{ flex: 1 }}/>
                      <button className="btn ghost sm" onClick={cancelEdit}>Anuluj</button>
                      <button className="btn primary sm" disabled={saving} onClick={() => save(svc.id)}>
                        {saving ? "⏳…" : "Zapisz i włącz"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── RSSCard z dialogiem dodawania ────────────────────────────────────────────

const RSSAddModal = ({ defaultDir, onSave, onClose }) => {
  const [name, setName]       = useState("");
  const [url, setUrl]         = useState("");
  const [filter, setFilter]   = useState("");
  const [dest, setDest]       = useState(defaultDir || "/var/lib/nimbus/downloads");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");

  const save = async () => {
    if (!name.trim() || !url.trim()) { setErr("Nazwa i URL są wymagane"); return; }
    setSaving(true);
    try {
      const existing = await api("/api/downloads/rss").then(d => d.feeds || []);
      const newFeed = {
        id:      `feed-${Date.now()}`,
        name:    name.trim(),
        url:     url.trim(),
        filter:  filter.trim(),
        dest_dir: dest,
        enabled,
        items: 0, matched: 0, dropped: 0,
      };
      await apiPost("/api/downloads/rss/save", { feeds: [...existing, newFeed] });
      onSave();
      onClose();
    } catch (e) { setErr(e.message); }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: 10, width: 520, padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>📡 Dodaj feed RSS</div>
            <div className="mono dim" style={{ fontSize: 10 }}>automatyczne monitorowanie · regex filtr · odpytywanie co 15 min</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={12}/></button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Nazwa</div>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="np. Sonarr · BTN"
                style={{ width: "100%", fontSize: 12, background: "var(--bg)", border: "1px solid var(--line)", padding: "8px 10px", borderRadius: 6, color: "var(--fg)" }}/>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 20 }}>
              <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>Aktywny</span>
              <div onClick={() => setEnabled(e => !e)} style={{ width: 36, height: 20, borderRadius: 10, cursor: "pointer", transition: "background .2s",
                background: enabled ? "var(--accent)" : "var(--bg-3)", border: "1px solid var(--line)", position: "relative" }}>
                <div style={{ width: 14, height: 14, borderRadius: "50%", background: "white", position: "absolute", top: 2,
                  left: enabled ? 18 : 2, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }}/>
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>URL Feeda RSS</div>
            <input className="input" value={url} onChange={e => setUrl(e.target.value)}
              placeholder="https://rss.tracker.pl/rss?authkey=..."
              style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "8px 10px", borderRadius: 6, color: "var(--fg)" }}/>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Filtr regex (opcjonalny)</span>
              <span className="mono dim" style={{ fontSize: 9 }}>dopasowuje tytuły itemów</span>
            </div>
            <input className="input" value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="np. 1080p|720p lub S\d+E\d+ dla seriali"
              style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 11, background: "var(--bg)", border: "1px solid var(--line)", padding: "8px 10px", borderRadius: 6, color: "var(--fg)" }}/>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Katalog docelowy</div>
            <DirectoryPicker value={dest} onChange={setDest}/>
          </div>

          {err && <div style={{ fontSize: 11, color: "var(--err)", padding: "6px 10px", borderRadius: 5, background: "color-mix(in oklch,var(--err) 8%,transparent)" }}>⚠ {err}</div>}

          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", paddingTop: 4 }}>
            <button className="btn ghost sm" onClick={onClose}>Anuluj</button>
            <button className="btn primary sm" disabled={saving} onClick={save}>
              <Icon name="plus" size={10}/> {saving ? "Zapisuję…" : "Dodaj feed"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const RSSCard = ({ defaultDir }) => {
  const [feeds, setFeeds]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    api("/api/downloads/rss")
      .then(d => { setFeeds(d.feeds || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, []);

  const refresh = async (id) => {
    await apiPost("/api/downloads/rss/refresh", { id });
    load();
  };

  const remove = async (id) => {
    const remaining = feeds.filter(f => f.id !== id);
    await apiPost("/api/downloads/rss/save", { feeds: remaining });
    load();
  };

  const toggle = async (f) => {
    const updated = feeds.map(x => x.id === f.id ? { ...x, enabled: !x.enabled } : x);
    await apiPost("/api/downloads/rss/save", { feeds: updated });
    load();
  };

  return (
    <>
      {showAdd && <RSSAddModal defaultDir={defaultDir} onSave={load} onClose={() => setShowAdd(false)}/>}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">RSS · monitorowanie</div><div className="card-sub">automatyczne dodawanie · regex · co 15 min</div></div>
          <button className="btn sm primary" onClick={() => setShowAdd(true)}>
            <Icon name="plus" size={10}/> Feed
          </button>
        </div>
        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}><span className="mono dim">Ładowanie…</span></div>
        ) : feeds.length === 0 ? (
          <div style={{ padding: "24px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-dim)" }}>Brak feedów RSS</div>
            <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}>Kliknij "+ Feed" aby dodać pierwszy feed</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Feed</th><th>Itemy</th><th>Traf.</th><th>Odrzuc.</th><th>Update</th><th></th></tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div onClick={() => toggle(f)} style={{ width: 6, height: 6, borderRadius: "50%", cursor: "pointer",
                        background: f.enabled ? "var(--ok)" : "var(--fg-dim)",
                        boxShadow: f.enabled ? "0 0 4px var(--ok)" : "none" }} title={f.enabled ? "Wyłącz" : "Włącz"}/>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</span>
                    </div>
                    {f.filter && <div className="mono dim" style={{ fontSize: 9, paddingLeft: 12, marginTop: 2 }}>/{f.filter}/</div>}
                  </td>
                  <td className="mono dim">{f.items || 0}</td>
                  <td className="mono" style={{ color: "var(--ok)" }}>{f.matched || 0}</td>
                  <td className="mono dim">{f.dropped || 0}</td>
                  <td className="mono dim" style={{ fontSize: 10 }}>{f.last_fetch || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button className="icon-btn" title="Odśwież teraz" onClick={() => refresh(f.id)}><Icon name="refresh" size={11}/></button>
                      <button className="icon-btn" title="Usuń" onClick={() => remove(f.id)}><Icon name="trash" size={11}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

// ─── Tabs (design new.jsx) ────────────────────────────────────────────────────

const DL_TABS = [
  { id: "queue",  label: "Kolejka",      emoji: "📥" },
  { id: "tools",  label: "Narzędzia",    emoji: "🛠" },
  { id: "cda",    label: "CDA.pl",       emoji: "🇵🇱" },
  { id: "config", label: "Konfiguracja", emoji: "⚙"  },
];

const DownloadTabs = ({ value, onChange, counts }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 4, padding: 4, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, alignSelf: "flex-start" }}>
    {DL_TABS.map(t => {
      const active = value === t.id;
      return (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          appearance: "none", cursor: "pointer", padding: "6px 12px", borderRadius: 5,
          background: active ? "var(--bg-1)" : "transparent",
          color: active ? "var(--fg)" : "var(--fg-dim)",
          border: active ? "1px solid var(--line-strong)" : "1px solid transparent",
          fontSize: 12, fontWeight: active ? 600 : 500,
          display: "inline-flex", alignItems: "center", gap: 6,
          boxShadow: active ? "0 1px 0 color-mix(in oklch, var(--accent) 30%, transparent)" : "none",
          transition: "all .15s",
        }}>
          {t.emoji} {t.label}
          {counts[t.id] !== undefined && (
            <span className="mono" style={{ fontSize: 10, padding: "0px 5px", borderRadius: 999,
              background: active ? "color-mix(in oklch, var(--accent) 18%, transparent)" : "var(--bg-3)",
              color: active ? "var(--accent)" : "var(--fg-dim)",
              fontWeight: 600, minWidth: 16, textAlign: "center" }}>{counts[t.id]}</span>
          )}
        </button>
      );
    })}
  </div>
);

// ─── DownloadsQueue (design new.jsx + API) ────────────────────────────────────

const DownloadsQueue = ({ tasks, loading, nimbusCount, arrCount, showArrQueue, onToggleArrQueue, onCancel, onDelete, onRetry, onClearDone, onRefresh, defaultDir, setDefaultDir }) => {
  const [filter, setFilter]         = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [selected, setSelected]     = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [addUrl, setAddUrl]         = useState("");
  const [addFilename, setAddFilename] = useState("");
  const [addTitleSet, setAddTitleSet] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addErr, setAddErr]         = useState("");

  const isCDA    = addUrl.toLowerCase().includes("cda.pl");
  const isSibnet = addUrl.toLowerCase().includes("sibnet.ru");
  const isFolder = isCDA && (addUrl.includes("/folder/") || addUrl.includes("/moje-cda/"));

  const sel = tasks.find(t => t.id === selected);

  const totalDown   = tasks.filter(t => (t.status||t.state) === "downloading").reduce((a, t) => { const s = parseFloat(t.speed); return a + (isNaN(s) ? 0 : s); }, 0);
  const totalUp     = tasks.reduce((a, t) => a + (t.speedUp || 0), 0);
  const activeCount = tasks.filter(t => (t.status||t.state) === "downloading").length;
  const seedCount   = tasks.filter(t => (t.status||t.state) === "seeding").length;
  const totalTodo   = tasks.reduce((a, t) => a + Math.max(0, (t.size || 0) - (t.done || 0)), 0);
  const eta         = totalDown > 0 ? Math.round((totalTodo * 1024) / totalDown / 60) : 0;

  // Speed history
  const speedHist = useRef([Array(60).fill(0), Array(60).fill(0)]);
  useEffect(() => {
    speedHist.current[0] = [...speedHist.current[0].slice(1), totalDown];
    speedHist.current[1] = [...speedHist.current[1].slice(1), totalUp];
  });

  const filtered = tasks.filter(t => {
    const cat = t.category || t.kind || "file";
    if (filter !== "all" && cat !== filter) return false;
    const st = t.status || t.state;
    if (stateFilter !== "all" && st !== stateFilter) return false;
    return true;
  });

  const handleAdd = async () => {
    if (!addUrl.trim()) { setAddErr("Podaj URL"); return; }
    setAddLoading(true); setAddErr("");
    try {
      let f = addFilename;
      if (!f && (isSibnet || isCDA)) f = "";
      const d = await apiPost("/api/downloads/add", { url: addUrl.trim(), dest_dir: defaultDir, filename: f });
      if (!d.ok) throw new Error(d.error || "Błąd");
      setAddUrl(""); setAddFilename(""); setAddTitleSet(false); onRefresh();
    } catch (e) { setAddErr(e.message); }
    setAddLoading(false);
  };

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi" style={{ borderColor: "color-mix(in oklch, var(--accent) 35%, var(--line))" }}>
          <div className="kpi-label"><Icon name="download" size={12}/> PRĘDKOŚĆ ŁĄCZNA</div>
          <div className="kpi-value" style={{ color: "var(--accent)" }}>
            {totalDown.toFixed(1)}<span className="kpi-unit">MB/s</span>
          </div>
          <div style={{ height: 4, background: "var(--bg-3)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: Math.min(100, totalDown) + "%", height: "100%", background: "var(--accent)", transition: "width 0.6s" }}/>
          </div>
          <div className="kpi-foot" style={{ marginTop: 4 }}>
            <span>live</span>
            <span style={{ color: "var(--ok)" }}>↑ {totalUp.toFixed(1)} MB/s</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="process" size={12}/> AKTYWNE</div>
          <div className="kpi-value">{activeCount}<span className="kpi-unit">/ {tasks.length}</span></div>
          <div className="kpi-foot" style={{ marginTop: 6 }}>
            {seedCount > 0 && <span>{seedCount} seed</span>}
            <span>{tasks.filter(t => (t.status||t.state) === "queued").length} w kolejce</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="clock" size={12}/> POZOSTAŁO</div>
          <div className="kpi-value" style={{ fontSize: 22 }}>
            {totalTodo > 0 ? totalTodo.toFixed(1) : activeCount + tasks.filter(t => (t.status||t.state) === "queued").length}
            <span className="kpi-unit">{totalTodo > 0 ? "GB" : " zadań"}</span>
          </div>
          <div className="kpi-foot" style={{ marginTop: 6 }}>
            <span>ETA łączny</span>
            <span className="mono" style={{ color: "var(--accent)" }}>
              {eta > 0 ? `~ ${eta} min` : "—"}
            </span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label"><Icon name="upload" size={12}/> RATIO</div>
          <div className="kpi-value" style={{ color: "var(--ok)" }}>
            {(() => {
              const ratios = tasks.filter(t => t.ratio != null && t.ratio > 0).map(t => t.ratio);
              return ratios.length > 0 ? (ratios.reduce((a, r) => a + r, 0) / ratios.length).toFixed(2) : "—";
            })()}
          </div>
          <div className="kpi-foot" style={{ marginTop: 6 }}>
            <span>śr. globalny</span>
            <span>cel ≥ 1.00</span>
          </div>
        </div>
      </div>

      {/* Wykres + Quoty */}
      <div className="grid grid-2-1">
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Przepustowość</div><div className="card-sub">ostatnia sesja · live</div></div>
            <div className="card-actions">
              <div className="segmented">
                <button className="active">1h</button><button>6h</button><button>24h</button><button>7d</button>
              </div>
            </div>
          </div>
          <div className="card-body">
            <DlSpeedChart down={speedHist.current[0]} up={speedHist.current[1]}/>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div><div className="card-title">Limity i kontyngenty</div><div className="card-sub">limity dzienne · ratio</div></div></div>
          <div className="card-body col" style={{ gap: 12 }}>
            {DL_QUOTAS.map((q, i) => {
              const val = q.value !== null ? q.value : (i === 3 ? String(activeCount) : "—");
              return (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{q.label}</span>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: q.color }}>
                      {val}<span style={{ color: "var(--fg-dim)", fontSize: 10, fontWeight: 400 }}> {q.unit}</span>
                    </span>
                  </div>
                  <div style={{ height: 5, background: "var(--bg-3)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: q.barPct + "%", height: "100%", background: q.color, transition: "width .4s" }}/>
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: "var(--fg-dim)", marginTop: 3 }}>{q.of}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pasek stanów + akcje */}
      <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--line)",
        display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
        <StateStrip tasks={tasks}/>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn"><Icon name="pause" size={11}/> Pauza globalna</button>
          <button className="btn primary" onClick={() => setShowAdd(s => !s)}>
            <Icon name="download" size={11}/> Dodaj
          </button>
        </div>
      </div>

      {/* Quick-add panel (design z new.jsx ale z prawdziwym API) */}
      {showAdd && (
        <div className="card" style={{ borderColor: "color-mix(in oklch, var(--accent) 40%, var(--line))" }}>
          <div className="card-head">
            <div><div className="card-title">Dodaj nowe pobieranie</div><div className="card-sub">URL · magnet · .torrent · CDA.pl · Sibnet.ru</div></div>
            <button className="icon-btn" onClick={() => setShowAdd(false)}><Icon name="close" size={14}/></button>
          </div>
          <div className="card-body col" style={{ gap: 10 }}>
            <input className="input" value={addUrl}
              onChange={e => { setAddUrl(e.target.value); if (!e.target.value.includes("cda.pl") && !e.target.value.includes("sibnet")) setAddTitleSet(false); }}
              onKeyDown={e => e.key === "Enter" && !isFolder && handleAdd()}
              placeholder="https:// · magnet:?xt=… · video.sibnet.ru/…"
              style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}/>

            {isCDA && !isFolder && <CDAPreview url={addUrl} onTitleReady={t => { if (!addTitleSet) { setAddFilename(t); setAddTitleSet(true); }}}/>}
            {isCDA && isFolder  && <CDAFolderBrowser url={addUrl} destDir={defaultDir} onQueued={onRefresh}/>}
            {isSibnet && <SibnetPreview url={addUrl} onTitleReady={t => { if (!addTitleSet) { setAddFilename(t); setAddTitleSet(true); }}}/>}

            {(isCDA && !isFolder) || isSibnet ? (
              <div>
                <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                  Nazwa pliku {addTitleSet && <span style={{ marginLeft: 6, color: "var(--ok)" }}>✓ z podglądu</span>}
                </div>
                <input className="input" value={addFilename} onChange={e => { setAddFilename(e.target.value); setAddTitleSet(false); }}
                  placeholder="auto (z tytułu strony)"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12, width: "100%" }}/>
              </div>
            ) : null}

            {!isFolder && !isCDA && !isSibnet && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--fg-dim)", letterSpacing: "0.06em", marginBottom: 4 }}>FOLDER ZAPISU</div>
                  <DirectoryPicker value={defaultDir} onChange={setDefaultDir}/>
                </div>
              </div>
            )}

            {addErr && <div style={{ fontSize: 11, color: "var(--err)", padding: "6px 10px", borderRadius: 5, background: "color-mix(in oklch,var(--err) 8%,transparent)" }}>⚠ {addErr}</div>}

            {!isFolder && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button className="btn ghost" onClick={() => { setShowAdd(false); setAddUrl(""); setAddFilename(""); }}>Anuluj</button>
                <button className="btn primary" disabled={addLoading || !addUrl.trim()} onClick={handleAdd}>
                  <Icon name="download" size={11}/> {addLoading ? "Dodawanie…" : "Rozpocznij"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabela + szczegóły */}
      <div style={{ display: "grid", gridTemplateColumns: sel ? "1fr 320px" : "1fr", gap: "var(--gutter)" }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Kolejka</div>
              <div className="card-sub">{filtered.length} z {tasks.length} zadań</div>
            </div>
            <div className="card-actions" style={{ gap: 4, flexWrap: "wrap" }}>
              {DL_CATEGORIES.slice(0, 7).map(c => {
                const cnt = c.id === "all" ? tasks.length : tasks.filter(t => (t.category||t.kind||"file") === c.id).length;
                if (cnt === 0 && c.id !== "all") return null;
                return (
                  <button key={c.id}
                    className={"btn sm " + (filter === c.id ? "primary" : "")}
                    style={{ padding: "3px 9px", fontSize: 10 }}
                    onClick={() => setFilter(c.id)}>
                    <Icon name={c.icon} size={10}/> {c.label}
                    {cnt > 0 && c.id !== "all" && <span style={{ marginLeft: 3, opacity: 0.7 }}>{cnt}</span>}
                  </button>
                );
              })}
              <button className="icon-btn" onClick={onRefresh}><Icon name="refresh" size={11}/></button>
            </div>
            {/* Toggle źródeł zewnętrznych (qBit/Sonarr) */}
            {arrCount > 0 || showArrQueue ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
                <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>Zewnętrzne klienty:</span>
                <button onClick={onToggleArrQueue} style={{
                  padding: "2px 10px", borderRadius: 5, fontSize: 10, cursor: "pointer",
                  border: `1px solid ${showArrQueue ? "var(--accent)" : "var(--line)"}`,
                  background: showArrQueue ? "color-mix(in oklch,var(--accent) 10%,transparent)" : "var(--bg-2)",
                  color: showArrQueue ? "var(--accent)" : "var(--fg-dim)",
                  fontWeight: showArrQueue ? 600 : 400,
                }}>
                  🧲 qBit / *arr {arrCount > 0 && `(${arrCount})`}
                </button>
                {showArrQueue && nimbusCount > 0 && (
                  <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>
                    + {nimbusCount} z nimbus-dl
                  </span>
                )}
              </div>
            ) : null}
          </div>
          {loading && tasks.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--fg-dim)", fontSize: 12 }}>Ładowanie…</div>
          ) : tasks.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📥</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-dim)" }}>Brak zadań</div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 5 }}>Kliknij „Dodaj" aby rozpocząć pobieranie</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Stan</th>
                  <th>Nazwa · postęp</th>
                  <th>Rozmiar</th>
                  <th>↓ / ↑</th>
                  <th>ETA</th>
                  <th>S / L</th>
                  <th>Ratio</th>
                  <th>Źródło</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <DlTaskRow key={t.id} task={t}
                    selected={selected === t.id} onSelect={setSelected}
                    onCancel={onCancel} onDelete={onDelete} onRetry={onRetry}/>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {sel && (
          <div className="card" style={{ padding: 0, position: "sticky", top: 16, alignSelf: "start" }}>
            <TaskDetailPanel task={sel}
              onCancel={onCancel} onDelete={onDelete} onRetry={onRetry}
              onClose={() => setSelected(null)}/>
          </div>
        )}
      </div>

      {/* Integracje + RSS */}
      <div className="grid grid-2">
        <IntegrationsCard/>
        <RSSCard defaultDir={defaultDir}/>
      </div>
    </div>
  );
};



// ─── Główny komponent ─────────────────────────────────────────────────────────

const Downloads = () => {
  const [tab, setTab]                   = useState("queue");
  const [tasks, setTasks]               = useState([]);
  const [arrTasks, setArrTasks]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [defaultDir, setDefaultDir]     = useState("/var/lib/nimbus/downloads");
  const [showArrQueue, setShowArrQueue] = useState(true);
  const pollRef = useRef(null);

  const loadTasks = useCallback(async () => {
    try {
      const [dl, arr] = await Promise.all([
        api("/api/downloads"),
        api("/api/downloads/arr/queue").catch(() => ({ tasks: [] })),
      ]);
      setTasks(dl.tasks || []);
      setArrTasks(arr.tasks || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTasks();
    api("/api/downloads/config").then(d => { if (d.default_dir) setDefaultDir(d.default_dir); }).catch(() => {});
    pollRef.current = setInterval(loadTasks, 2000);
    return () => clearInterval(pollRef.current);
  }, []);

  // Scal kolejki — nimbus-dl zadania + zadania z zewnętrznych klientów
  const allTasks = [
    ...tasks,
    ...(showArrQueue ? arrTasks : []),
  ];

  const handleCancel    = async id => { await apiPost("/api/downloads/cancel",      { id }); loadTasks(); };
  const handleDelete    = async id => { await apiPost("/api/downloads/delete",      { id }); loadTasks(); };
  const handleRetry     = async id => { await apiPost("/api/downloads/retry",       { id }); loadTasks(); };
  const handleClearDone = async ()  => { await apiPost("/api/downloads/clear-done", {}); loadTasks(); };

  return (
    <div className="col" style={{ gap: "var(--gutter)" }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>

      <DownloadTabs value={tab} onChange={setTab} counts={{
        queue: tasks.length > 0 ? tasks.length : undefined,
      }}/>

      {tab === "tools"  && <ToolsTab/>}
      {tab === "cda"    && <CDATab/>}
      {tab === "config" && <ConfigTab defaultDir={defaultDir} setDefaultDir={setDefaultDir}/>}
      {tab === "queue"  && (
        <DownloadsQueue tasks={allTasks} loading={loading}
          nimbusCount={tasks.length} arrCount={arrTasks.length}
          showArrQueue={showArrQueue} onToggleArrQueue={() => setShowArrQueue(s => !s)}
          onCancel={handleCancel} onDelete={handleDelete}
          onRetry={handleRetry} onClearDone={handleClearDone}
          onRefresh={loadTasks}
          defaultDir={defaultDir} setDefaultDir={setDefaultDir}/>
      )}
    </div>
  );
};

window.Downloads = Downloads;
window.DownloadCenter = Downloads;
