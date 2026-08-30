// screens-terminal.jsx — Prawdziwy terminal PTY przez WebSocket + xterm.js
// xterm.js ładowany z CDN (bez bundlowania — za duże)

const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = reject;
  document.head.appendChild(s);
});
const loadCSS = (href) => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
};

const XTERM_VER = '5.3.0';
const XTERM_CDN = `https://cdn.jsdelivr.net/npm/xterm@${XTERM_VER}/lib/xterm.js`;
const XTERM_CSS = `https://cdn.jsdelivr.net/npm/xterm@${XTERM_VER}/css/xterm.css`;
const XTERM_FIT = `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js`;
const XTERM_WL  = `https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js`;
const XTERM_SRC = `https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.16.0/lib/addon-search.min.js`;

// Motyw PuTTY/Nimbus
const TERM_THEME = {
  background:    '#0d1117',
  foreground:    '#c9d1d9',
  cursor:        '#58a6ff',
  cursorAccent:  '#0d1117',
  selectionBackground: 'rgba(88,166,255,0.3)',
  black:         '#484f58',
  red:           '#ff7b72',
  green:         '#3fb950',
  yellow:        '#d29922',
  blue:          '#58a6ff',
  magenta:       '#bc8cff',
  cyan:          '#39c5cf',
  white:         '#b1bac4',
  brightBlack:   '#6e7681',
  brightRed:     '#ffa198',
  brightGreen:   '#56d364',
  brightYellow:  '#e3b341',
  brightBlue:    '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan:    '#56d4dd',
  brightWhite:   '#f0f6fc',
};

// Dostępne motywy
const THEMES = {
  nimbus:    { label: 'Nimbus (domyślny)', bg: '#0d1117', fg: '#c9d1d9', cursor: '#58a6ff' },
  putty:     { label: 'PuTTY Classic',    bg: '#000000', fg: '#ffffff', cursor: '#ffffff' },
  solarized: { label: 'Solarized Dark',   bg: '#002b36', fg: '#839496', cursor: '#268bd2' },
  monokai:   { label: 'Monokai',          bg: '#272822', fg: '#f8f8f2', cursor: '#f8f8f0' },
  gruvbox:   { label: 'Gruvbox Dark',     bg: '#282828', fg: '#ebdbb2', cursor: '#fabd2f' },
  nord:      { label: 'Nord',             bg: '#2e3440', fg: '#d8dee9', cursor: '#88c0d0' },
  dracula:   { label: 'Dracula',          bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2' },
};

const TerminalView = () => {
  const containerRef  = React.useRef(null);
  const termRef       = React.useRef(null);   // xterm.Terminal
  const fitRef        = React.useRef(null);   // FitAddon
  const wsRef         = React.useRef(null);   // WebSocket
  const [status,  setStatus]  = React.useState('loading'); // loading|connecting|connected|disconnected|error
  const [errMsg,  setErrMsg]  = React.useState('');
  const [shells,  setShells]  = React.useState(['/bin/bash']);
  const [shell,   setShell]   = React.useState('/bin/bash');
  const [theme,   setTheme]   = React.useState('nimbus');
  const [fontSize,setFontSize]= React.useState(14);
  const [showBar, setShowBar] = React.useState(true);
  const [sessions,setSessions]= React.useState([]);

  // Załaduj dostępne shelle
  React.useEffect(() => {
    fetch('/terminal/shells', {credentials:'include'})
      .then(r => r.json())
      .then(d => { if (d.shells?.length) setShells(d.shells); })
      .catch(() => {});
  }, []);

  // Załaduj xterm.js i uruchom terminal
  React.useEffect(() => {
    let destroyed = false;

    const init = async () => {
      try {
        setStatus('loading');
        loadCSS(XTERM_CSS);
        await loadScript(XTERM_CDN);
        await loadScript(XTERM_FIT);
        await loadScript(XTERM_WL);
        await loadScript(XTERM_SRC);
        if (destroyed) return;
        startTerminal();
      } catch (e) {
        setStatus('error');
        setErrMsg('Błąd ładowania xterm.js z CDN: ' + e.message);
      }
    };

    init();
    return () => {
      destroyed = true;
      cleanup();
    };
  }, []);

  const cleanup = () => {
    wsRef.current?.close();
    termRef.current?.dispose();
    termRef.current = null;
    wsRef.current = null;
  };

  const startTerminal = () => {
    if (!containerRef.current) return;
    cleanup();

    const T = window.Terminal;
    const FitAddon   = window.FitAddon?.FitAddon;
    const WebLinksAddon = window.WebLinksAddon?.WebLinksAddon;

    const term = new T({
      theme: buildTheme(theme),
      fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", Consolas, monospace',
      fontSize,
      lineHeight: 1.2,
      letterSpacing: 0,
      scrollback: 5000,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      convertEol: false,
      allowProposedApi: true,
    });

    const fit = FitAddon ? new FitAddon() : null;
    if (fit) term.loadAddon(fit);
    if (WebLinksAddon) term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    if (fit) fit.fit();
    fitRef.current = fit;
    termRef.current = term;

    setStatus('connecting');
    connectWS(term, fit);
  };

  const buildTheme = (name) => {
    const t = THEMES[name] || THEMES.nimbus;
    return { ...TERM_THEME, background: t.bg, foreground: t.fg, cursor: t.cursor };
  };

  const connectWS = (term, fit) => {
    const cols = term.cols || 220;
    const rows = term.rows || 50;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/terminal/ws?cols=${cols}&rows=${rows}&shell=${encodeURIComponent(shell)}`;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      setErrMsg('');
      term.focus();
    };

    ws.onmessage = (evt) => {
      // Dane z PTY → wypisz do terminala
      const data = evt.data instanceof ArrayBuffer
        ? new Uint8Array(evt.data)
        : evt.data;
      term.write(data);
    };

    ws.onerror = () => {
      setStatus('error');
      setErrMsg('Błąd połączenia WebSocket');
    };

    ws.onclose = (e) => {
      setStatus('disconnected');
      term.write('\r\n\x1b[31m[Sesja zakończona]\x1b[0m\r\n');
      // Odśwież listę sesji
      fetchSessions();
    };

    // Klawiatura → WebSocket
    term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const enc = new TextEncoder().encode(data);
      const msg = new Uint8Array(1 + enc.length);
      msg[0] = 0x30; // '0' = stdin
      msg.set(enc, 1);
      ws.send(msg);
    });

    // Resize → WebSocket
    term.onResize(({ cols, rows }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const msg = new Uint8Array(5);
      msg[0] = 0x31; // '1' = resize
      new DataView(msg.buffer).setUint16(1, cols, true);
      new DataView(msg.buffer).setUint16(3, rows, true);
      ws.send(msg);
    });
  };

  // Resize observer
  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch {}
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const reconnect = () => {
    if (termRef.current && fitRef.current) {
      cleanup();
      startTerminal();
    }
  };

  const fetchSessions = () => {
    fetch('/terminal/sessions', {credentials:'include'})
      .then(r => r.json())
      .then(d => setSessions(d.sessions || []))
      .catch(() => {});
  };

  React.useEffect(() => {
    fetchSessions();
    const id = setInterval(fetchSessions, 5000);
    return () => clearInterval(id);
  }, []);

  // Zmiana motywu/czcionki bez restartu
  React.useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme    = buildTheme(theme);
    termRef.current.options.fontSize = fontSize;
    if (fitRef.current) try { fitRef.current.fit(); } catch {}
  }, [theme, fontSize]);

  const statusColor = {
    loading:      'var(--fg-dim)',
    connecting:   'var(--warn)',
    connected:    'var(--ok)',
    disconnected: 'var(--err)',
    error:        'var(--err)',
  };
  const statusLabel = {
    loading:      'Ładowanie…',
    connecting:   'Łączenie…',
    connected:    'Połączono',
    disconnected: 'Rozłączono',
    error:        'Błąd',
  };

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:'calc(100vh - 120px)'}}>

      {/* Pasek narzędziowy */}
      {showBar && (
        <div style={{
          display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',
          padding:'6px 12px',
          background:'var(--bg-1)',borderBottom:'1px solid var(--line)',
          flexShrink:0,
        }}>
          {/* Status */}
          <div style={{display:'flex',alignItems:'center',gap:6,marginRight:4}}>
            <span style={{
              width:8,height:8,borderRadius:'50%',flexShrink:0,
              background: statusColor[status] || 'var(--fg-dim)',
              boxShadow: status==='connected' ? '0 0 6px var(--ok)' : 'none',
              animation: status==='connecting' ? '_led-pulse .6s ease-in-out infinite alternate' : 'none',
            }}/>
            <span style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',color:statusColor[status]}}>
              {statusLabel[status]}
            </span>
          </div>

          {/* Shell selector */}
          <select value={shell} onChange={e=>setShell(e.target.value)}
            style={{height:28,padding:'0 8px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:5,color:'var(--fg)',fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
            {shells.map(sh => <option key={sh} value={sh}>{sh}</option>)}
          </select>

          {/* Motyw */}
          <select value={theme} onChange={e=>setTheme(e.target.value)}
            style={{height:28,padding:'0 8px',background:'var(--bg-2)',border:'1px solid var(--line-strong)',
              borderRadius:5,color:'var(--fg)',fontSize:'var(--fs-xs)'}}>
            {Object.entries(THEMES).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {/* Rozmiar czcionki */}
          <div style={{display:'flex',alignItems:'center',gap:4}}>
            <button onClick={()=>setFontSize(f=>Math.max(8,f-1))}
              style={{width:22,height:22,borderRadius:4,border:'1px solid var(--line-strong)',
                background:'var(--bg-2)',color:'var(--fg)',cursor:'pointer',fontSize:12}}>−</button>
            <span style={{fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)',minWidth:22,textAlign:'center'}}>
              {fontSize}
            </span>
            <button onClick={()=>setFontSize(f=>Math.min(32,f+1))}
              style={{width:22,height:22,borderRadius:4,border:'1px solid var(--line-strong)',
                background:'var(--bg-2)',color:'var(--fg)',cursor:'pointer',fontSize:12}}>+</button>
          </div>

          <div style={{flex:1}}/>

          {/* Sesje */}
          {sessions.length > 0 && (
            <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
              {sessions.length} {sessions.length===1?'sesja':'sesji'} aktywna
            </span>
          )}

          {/* Nowa sesja / Rozłącz */}
          <button onClick={reconnect}
            style={{height:26,padding:'0 10px',borderRadius:5,border:'1px solid var(--line-strong)',
              background:'var(--bg-2)',color:'var(--fg)',cursor:'pointer',fontSize:'var(--fs-xs)'}}>
            ↺ Nowa sesja
          </button>
          {status==='connected' && (
            <button onClick={() => wsRef.current?.close()}
              style={{height:26,padding:'0 10px',borderRadius:5,border:'1px solid color-mix(in oklch,var(--err) 40%,transparent)',
                background:'color-mix(in oklch,var(--err) 8%,transparent)',
                color:'var(--err)',cursor:'pointer',fontSize:'var(--fs-xs)'}}>
              ✕ Rozłącz
            </button>
          )}
          <button onClick={()=>setShowBar(false)} title="Ukryj pasek (F11 = pełny ekran)"
            style={{height:26,width:26,borderRadius:5,border:'1px solid var(--line-strong)',
              background:'var(--bg-2)',color:'var(--fg-muted)',cursor:'pointer',fontSize:12}}>
            ⤢
          </button>
        </div>
      )}

      {/* Przycisk przywrócenia paska */}
      {!showBar && (
        <button onClick={()=>setShowBar(true)}
          style={{position:'absolute',top:8,right:8,zIndex:10,
            height:22,padding:'0 8px',borderRadius:4,border:'1px solid var(--line-strong)',
            background:'rgba(0,0,0,.6)',color:'var(--fg-muted)',cursor:'pointer',fontSize:11}}>
          ☰
        </button>
      )}

      {/* Error */}
      {status==='error' && errMsg && (
        <div style={{padding:'12px 16px',background:'color-mix(in oklch,var(--err) 10%,transparent)',
          border:'1px solid color-mix(in oklch,var(--err) 30%,transparent)',
          margin:12,borderRadius:8,fontSize:'var(--fs-sm)',color:'var(--err)'}}>
          ❌ {errMsg}
          {errMsg.includes('CDN') && (
            <div style={{marginTop:8,fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
              Sprawdź połączenie z internetem — xterm.js jest ładowany z cdn.jsdelivr.net
            </div>
          )}
        </div>
      )}

      {/* Kontener terminala */}
      <div style={{flex:1,position:'relative',overflow:'hidden',background:'#0d1117',minHeight:300}}>
        <div
          ref={containerRef}
          style={{
            position:'absolute',inset:0,
            padding:'4px 8px',
            // xterm.js renderuje canvas — overflow hidden ważny
            overflow:'hidden',
          }}
        />
        {(status==='loading'||status==='connecting') && (
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
            justifyContent:'center',background:'#0d1117',zIndex:5,
            flexDirection:'column',gap:12,color:'#58a6ff'}}>
            <div style={{width:20,height:20,border:'2px solid #30363d',borderTopColor:'#58a6ff',
              borderRadius:'50%',animation:'_spin .6s linear infinite'}}/>
            <span style={{fontFamily:'monospace',fontSize:13,color:'#8b949e'}}>
              {status==='loading' ? 'Ładowanie xterm.js…' : `Łączenie z ${shell}…`}
            </span>
          </div>
        )}
        {status==='disconnected' && (
          <div style={{position:'absolute',bottom:16,left:'50%',transform:'translateX(-50%)',
            background:'rgba(22,27,34,.95)',border:'1px solid #30363d',borderRadius:8,
            padding:'10px 20px',display:'flex',gap:12,alignItems:'center',zIndex:5}}>
            <span style={{fontFamily:'monospace',fontSize:12,color:'#f85149'}}>Sesja zakończona</span>
            <button onClick={reconnect}
              style={{padding:'4px 12px',borderRadius:5,border:'1px solid #388bfd',
                background:'#0c2d6b',color:'#58a6ff',cursor:'pointer',fontFamily:'monospace',fontSize:12}}>
              Nowa sesja
            </button>
          </div>
        )}
      </div>

      {/* Skróty klawiaturowe */}
      {showBar && (
        <div style={{padding:'4px 12px',background:'var(--bg)',borderTop:'1px solid var(--line)',
          display:'flex',gap:16,flexShrink:0}}>
          {[['Ctrl+C','przerwij'],['Ctrl+D','wyloguj'],['Ctrl+L','wyczyść'],
            ['Ctrl+Shift+C','kopiuj'],['Ctrl+Shift+V','wklej'],['Tab','dopełnij']].map(([k,v])=>(
            <span key={k} style={{fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
              <span style={{background:'var(--bg-2)',border:'1px solid var(--line-strong)',
                borderRadius:3,padding:'0 4px',marginRight:3}}>{k}</span>
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

window.Terminal = TerminalView;
