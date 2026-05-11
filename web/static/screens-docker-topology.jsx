// ===== Docker Network Topology =====
// Wizualizacja: kontenery → sieci → hosty

const { useState: useStateT, useEffect: useEffectT, useRef: useRefT, useMemo: useMemoT, useCallback: useCallbackT } = React;

// Kolory sieci
const NET_COLORS = {
  'nimbus_default': 'oklch(0.65 0.18 245)',
  'media_net':      'oklch(0.72 0.14 150)',
  'proxy_net':      'oklch(0.78 0.15 75)',
  'bridge':         'oklch(0.68 0.12 290)',
  'host':           'oklch(0.7 0.1 30)',
};

const TAG_COLORS = {
  'media':  'oklch(0.72 0.14 150)',
  '*arr':   'oklch(0.78 0.15 75)',
  'net':    'oklch(0.65 0.18 245)',
  'home':   'oklch(0.75 0.13 60)',
  'db':     'oklch(0.68 0.12 290)',
  'sec':    'oklch(0.7 0.16 25)',
  'cloud':  'oklch(0.7 0.15 200)',
  'obs':    'oklch(0.7 0.12 320)',
  'sync':   'oklch(0.72 0.14 150)',
};

// Przypisanie kontenerów do sieci (mock)
const CONTAINER_NETWORKS = {
  'plex':          ['nimbus_default', 'media_net'],
  'jellyfin':      ['nimbus_default', 'media_net'],
  'sonarr':        ['nimbus_default', 'media_net'],
  'radarr':        ['nimbus_default', 'media_net'],
  'qbittorrent':   ['nimbus_default'],
  'homeassistant': ['nimbus_default', 'host'],
  'nginx-proxy':   ['nimbus_default', 'proxy_net'],
  'postgres':      ['nimbus_default'],
  'vaultwarden':   ['proxy_net'],
  'nextcloud':     ['nimbus_default', 'proxy_net'],
  'grafana':       ['nimbus_default'],
  'syncthing':     ['nimbus_default'],
};

const CONTAINER_PORTS = {
  'plex':          '32400',
  'jellyfin':      '8096',
  'sonarr':        '8989',
  'radarr':        '7878',
  'qbittorrent':   '8080',
  'homeassistant': '8123',
  'nginx-proxy':   '80, 443',
  'postgres':      '5432',
  'vaultwarden':   '8443',
  'nextcloud':     '8800',
  'grafana':       '3000',
  'syncthing':     '8384',
};

const NETWORKS_LIST = ['nimbus_default', 'media_net', 'proxy_net', 'bridge', 'host'];

// ── ContainerNode ─────────────────────────────────────────────────────────────
const ContainerNode = ({ c, x, y, selected, onSelect, highlight }) => {
  const tagColor = TAG_COLORS[c.tag] || 'var(--fg-dim)';
  const isRunning = c.state === 'running';
  const isDimmed = highlight && !selected;

  return (
    <g
      transform={`translate(${x},${y})`}
      style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.2s' }}
      onClick={(e) => { e.stopPropagation(); onSelect(c.id); }}
    >
      {/* glow za kartą gdy selected */}
      {selected && (
        <rect x="-62" y="-34" width="124" height="68" rx="10"
          fill="none" stroke={tagColor} strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 8px ${tagColor})` }} />
      )}
      {/* karta */}
      <rect x="-60" y="-32" width="120" height="64" rx="8"
        fill="var(--bg-2)" stroke={selected ? tagColor : 'var(--line)'}
        strokeWidth={selected ? 1.5 : 1} />
      {/* pasek statusu */}
      <rect x="-60" y="-32" width="10" height="64" rx="8"
        fill={isRunning ? 'oklch(0.72 0.14 150)' : c.state === 'restarting' ? 'oklch(0.78 0.15 75)' : 'var(--fg-dim)'}
        style={{ opacity: 0.9 }} />
      <rect x="-54" y="-32" width="4" height="64"
        fill={isRunning ? 'oklch(0.72 0.14 150)' : c.state === 'restarting' ? 'oklch(0.78 0.15 75)' : 'var(--fg-dim)'}
        style={{ opacity: 0.9 }} />

      {/* ikona tagu */}
      <circle cx="-34" cy="0" r="16" fill={tagColor} opacity="0.15" />
      <text x="-34" y="5" textAnchor="middle" fontSize="13" fill={tagColor} fontWeight="700">
        {c.name[0].toUpperCase()}
      </text>

      {/* nazwa */}
      <text x="14" y="-10" fontSize="11" fontWeight="600" fill="var(--fg)" fontFamily="var(--font-mono)">
        {c.name.length > 12 ? c.name.slice(0, 11) + '…' : c.name}
      </text>
      {/* port */}
      <text x="14" y="4" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)">
        :{CONTAINER_PORTS[c.name] || '—'}
      </text>
      {/* tag */}
      <rect x="12" y="10" width={c.tag.length * 6 + 8} height="14" rx="3"
        fill={tagColor} opacity="0.18" />
      <text x="16" y="21" fontSize="8" fill={tagColor} fontFamily="var(--font-mono)" fontWeight="600">
        {c.tag}
      </text>

      {/* dot status */}
      <circle cx="44" cy="-20" r="4"
        fill={isRunning ? 'oklch(0.72 0.14 150)' : c.state === 'restarting' ? 'oklch(0.78 0.15 75)' : 'var(--fg-dim)'} />
    </g>
  );
};

// ── NetworkBand ────────────────────────────────────────────────────────────────
const NetworkBand = ({ name, x, y, width, height, color, containerCount }) => (
  <g>
    <rect x={x} y={y} width={width} height={height} rx="12"
      fill={color} opacity="0.06"
      stroke={color} strokeWidth="1.5" strokeOpacity="0.3"
      strokeDasharray="6 3" />
    <rect x={x + 12} y={y - 11} width={name.length * 8 + 24} height="22" rx="6"
      fill="var(--bg-1)" stroke={color} strokeWidth="1" strokeOpacity="0.5" />
    <text x={x + 24} y={y + 5} fontSize="10" fontWeight="700"
      fill={color} fontFamily="var(--font-mono)" letterSpacing="0.04em">
      {name}
    </text>
    <text x={x + 24 + name.length * 8 - 4} y={y + 5} fontSize="9"
      fill={color} fontFamily="var(--font-mono)" opacity="0.7">
      · {containerCount}
    </text>
  </g>
);

// ── Edge (połączenie kontener→sieć) ───────────────────────────────────────────
const Edge = ({ x1, y1, x2, y2, color, active }) => {
  const mx = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  return (
    <path d={d} fill="none"
      stroke={color} strokeWidth={active ? 2 : 1}
      strokeOpacity={active ? 0.8 : 0.2}
      strokeDasharray={active ? 'none' : '4 3'}
      style={{ transition: 'stroke-opacity 0.2s, stroke-width 0.2s' }} />
  );
};

// ── Główny widok topologii ─────────────────────────────────────────────────────
const DockerTopology = () => {
  const svgRef = useRefT(null);
  const [selected, setSelected] = useStateT(null);
  const [hovNet, setHovNet] = useStateT(null);
  const [zoom, setZoom] = useStateT(1);
  const [pan, setPan] = useStateT({ x: 0, y: 0 });
  const [dragging, setDragging] = useStateT(false);
  const [dragStart, setDragStart] = useStateT(null);
  const [filter, setFilter] = useStateT('all');

  const containers = window.CONTAINERS;

  // Filtrowanie
  const visibleContainers = useMemoT(() =>
    filter === 'all' ? containers : containers.filter(c => c.state === filter),
  [filter, containers]);

  // Układanie kontenerów w siatce wewnątrz pasów sieciowych
  // Każda sieć to poziomy "pas", kontenery które do niej należą lądują w tym pasie
  const BAND_H = 110;
  const BAND_PAD = 30;
  const CONT_W = 130;

  const layout = useMemoT(() => {
    const result = { networks: {}, containers: {}, edges: [] };

    NETWORKS_LIST.forEach((net, ni) => {
      const membersAll = visibleContainers.filter(c =>
        (CONTAINER_NETWORKS[c.name] || []).includes(net)
      );
      const members = membersAll;
      const bandY = 60 + ni * (BAND_H + BAND_PAD);
      const bandW = Math.max(800, members.length * CONT_W + 120);
      result.networks[net] = { y: bandY, w: bandW, members, color: NET_COLORS[net] || 'var(--fg-dim)' };
    });

    // Pozycje kontenerów — każdy kontener pojawia się w KAŻDEJ sieci do której należy
    visibleContainers.forEach((c) => {
      const nets = CONTAINER_NETWORKS[c.name] || [];
      nets.forEach(net => {
        const band = result.networks[net];
        if (!band) return;
        const idx = band.members.findIndex(m => m.id === c.id);
        const x = 80 + idx * CONT_W + 60;
        const y = band.y + BAND_H / 2;
        const key = `${c.id}::${net}`;
        result.containers[key] = { x, y, c, net };
      });
    });

    return result;
  }, [visibleContainers]);

  const totalH = NETWORKS_LIST.length * (BAND_H + BAND_PAD) + 120;
  const totalW = Math.max(...Object.values(layout.networks).map(n => n.w), 900);

  // Drag pan
  const onMouseDown = (e) => {
    if (e.target.closest('g[data-node]')) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };
  const onMouseMove = (e) => {
    if (!dragging || !dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const onMouseUp = () => { setDragging(false); setDragStart(null); };

  const onWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.4, Math.min(2, z + delta)));
  };

  // Detail panel dla wybranego kontenera
  const selContainer = selected ? containers.find(c => c.id === selected) : null;
  const selNets = selContainer ? (CONTAINER_NETWORKS[selContainer.name] || []) : [];

  return (
    <div className="col" style={{ gap: 'var(--gutter)' }}>
      {/* Toolbar */}
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="row gap-sm">
          <span className="card-title" style={{ fontSize: 'var(--fs-base)' }}>Topologia sieci Docker</span>
          <span className="badge ok"><span className="dot pulse" />
            {containers.filter(c => c.state === 'running').length} aktywnych
          </span>
        </div>
        <div className="row gap-sm">
          <div className="segmented">
            {['all', 'running', 'stopped'].map(f => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {{ all: 'Wszystkie', running: 'Aktywne', stopped: 'Zatrzymane' }[f]}
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>
            <Icon name="refresh" size={12} /> Reset widoku
          </button>
          <div className="row gap-sm" style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
            <button className="icon-btn" onClick={() => setZoom(z => Math.max(0.4, z - 0.15))}>−</button>
            <span style={{ minWidth: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
            <button className="icon-btn" onClick={() => setZoom(z => Math.min(2, z + 0.15))}>+</button>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--gutter)', alignItems: 'flex-start' }}>
        {/* SVG Canvas */}
        <div className="card" style={{ flex: 1, overflow: 'hidden', padding: 0, position: 'relative', minHeight: 520 }}>
          <div style={{
            width: '100%', height: 520, overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab',
            background: 'var(--bg)',
          }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onClick={() => setSelected(null)}
          >
            <svg ref={svgRef} width="100%" height="100%">
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

                {/* Paski sieci */}
                {NETWORKS_LIST.map(net => {
                  const band = layout.networks[net];
                  if (!band) return null;
                  return (
                    <NetworkBand key={net}
                      name={net} x={20} y={band.y}
                      width={band.w} height={BAND_H}
                      color={band.color}
                      containerCount={band.members.length}
                    />
                  );
                })}

                {/* Kontenery */}
                {Object.entries(layout.containers).map(([key, { x, y, c, net }]) => {
                  const isSelected = selected === c.id;
                  const isHighlight = selected !== null;
                  const netColor = NET_COLORS[net] || 'var(--fg-dim)';

                  return (
                    <g key={key} data-node="1">
                      {/* pionowa linia łącząca z górną krawędzią pasa */}
                      <line
                        x1={x} y1={y - 32} x2={x} y2={layout.networks[net]?.y || y}
                        stroke={netColor} strokeWidth={isSelected ? 1.5 : 0.5}
                        strokeOpacity={isSelected ? 0.6 : 0.2}
                        strokeDasharray="3 3"
                      />
                      <ContainerNode
                        c={c} x={x} y={y}
                        selected={isSelected}
                        highlight={isHighlight && !isSelected}
                        onSelect={setSelected}
                      />
                    </g>
                  );
                })}

                {/* Połączenia między kontenerami w tej samej sieci gdy zaznaczony */}
                {selContainer && selNets.map(net => {
                  const band = layout.networks[net];
                  if (!band) return null;
                  const selKey = `${selContainer.id}::${net}`;
                  const selPos = layout.containers[selKey];
                  if (!selPos) return null;
                  const netColor = NET_COLORS[net] || 'var(--fg-dim)';
                  return band.members
                    .filter(m => m.id !== selContainer.id)
                    .map(m => {
                      const mKey = `${m.id}::${net}`;
                      const mPos = layout.containers[mKey];
                      if (!mPos) return null;
                      return (
                        <Edge key={`edge-${selContainer.id}-${m.id}-${net}`}
                          x1={selPos.x} y1={selPos.y}
                          x2={mPos.x} y2={mPos.y}
                          color={netColor} active={true} />
                      );
                    });
                })}
              </g>
            </svg>
          </div>

          {/* legenda */}
          <div style={{
            position: 'absolute', bottom: 12, left: 12,
            display: 'flex', gap: 12, flexWrap: 'wrap',
            background: 'var(--bg-1)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '6px 12px',
          }}>
            {NETWORKS_LIST.filter(n => layout.networks[n]?.members.length > 0).map(n => (
              <div key={n} className="row gap-sm" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: NET_COLORS[n] || 'var(--fg-dim)', display: 'inline-block', flexShrink: 0 }} />
                {n}
              </div>
            ))}
            <div className="row gap-sm" style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
              Scroll = zoom · Drag = pan · Klik = szczegóły
            </div>
          </div>
        </div>

        {/* Detail panel */}
        <div style={{ width: 260, flexShrink: 0 }}>
          {selContainer ? (
            <div className="card">
              <div className="card-head" style={{ padding: '14px 16px 10px' }}>
                <div className="row gap-sm">
                  <div className="cont-icon" style={{ width: 32, height: 32, fontSize: 14, flexShrink: 0 }}>
                    {selContainer.name[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{selContainer.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)' }}>
                      {selContainer.state}
                    </div>
                  </div>
                </div>
                <button className="icon-btn" onClick={() => setSelected(null)}><Icon name="close" size={13} /></button>
              </div>
              <div className="card-body col" style={{ gap: 10, padding: '0 16px 14px' }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                  {selContainer.image.split('/').pop()}
                </div>
                <hr className="div" />
                <KV k="Port" v={<span className="mono" style={{ fontSize: 11 }}>{CONTAINER_PORTS[selContainer.name] || '—'}</span>} />
                <KV k="CPU" v={<span className="mono" style={{ fontSize: 11 }}>{selContainer.cpu}%</span>} />
                <KV k="RAM" v={<span className="mono" style={{ fontSize: 11 }}>{selContainer.mem} MB</span>} />
                <KV k="Uptime" v={<span className="mono" style={{ fontSize: 11 }}>{selContainer.uptime}</span>} />
                <hr className="div" />
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 500, marginBottom: 4 }}>
                  Sieci ({selNets.length})
                </div>
                {selNets.map(n => (
                  <div key={n} className="row gap-sm" style={{ padding: '6px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: NET_COLORS[n] || 'var(--fg-dim)', display: 'inline-block', flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{n}</span>
                  </div>
                ))}
                <hr className="div" />
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 500, marginBottom: 4 }}>
                  Kontenery w tej samej sieci
                </div>
                {selNets.flatMap(n =>
                  (layout.networks[n]?.members || [])
                    .filter(m => m.id !== selContainer.id)
                ).filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
                  .map(m => (
                    <div key={m.id} className="row gap-sm" style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 5 }}
                      onClick={() => setSelected(m.id)}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span className="dot" style={{ color: m.state === 'running' ? 'var(--ok)' : 'var(--fg-dim)' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{m.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-body col" style={{ gap: 10, padding: 16 }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 500 }}>
                  Podsumowanie sieci
                </div>
                {NETWORKS_LIST.filter(n => layout.networks[n]?.members.length > 0).map(net => {
                  const band = layout.networks[net];
                  const running = band.members.filter(m => m.state === 'running').length;
                  return (
                    <div key={net} style={{ padding: '8px 10px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 6 }}>
                      <div className="row gap-sm" style={{ marginBottom: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: band.color, display: 'inline-block', flexShrink: 0 }} />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>{net}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-dim)' }}>
                        <span>{band.members.length} kontenerów</span>
                        <span style={{ color: 'var(--ok)' }}>{running} running</span>
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-dim)' }}>
                  Kliknij kontener aby zobaczyć jego połączenia w sieci.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

window.DockerTopology = DockerTopology;
