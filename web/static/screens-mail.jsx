// ===== Mail Server (Postfix + Dovecot) — API-driven =====

const QueueRow = ({ q, onAction }) => {
  const [detail, setDetail] = React.useState(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);

  const showDetail = async () => {
    if (detail) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const r = await fetch(`/api/mail/queue/detail/${q.id}`, { credentials:'include' });
      const d = await r.json();
      setDetail(d.content || 'Brak treści');
    } catch(e) { setDetail('Błąd pobierania'); }
    finally { setLoadingDetail(false); }
  };

  return (
    <>
      <tr style={{background: q.status==='deferred'?'oklch(0.78 0.15 75/0.04)':''}}>
        <td className="mono" style={{fontSize:11,color:'var(--accent)',cursor:'pointer'}} onClick={showDetail}>{q.id}</td>
        <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{q.from || '—'}</td>
        <td className="mono" style={{fontSize:'var(--fs-xs)'}}>{q.to || '—'}</td>
        <td className="mono dim">{q.size}</td>
        <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{q.time}</td>
        <td>
          {q.status==='active'   && <span className="badge ok">ACTIVE</span>}
          {q.status==='deferred' && <span className="badge warn">DEFERRED</span>}
          {q.status==='hold'     && <span className="badge">HOLD</span>}
        </td>
        <td style={{fontSize:'var(--fs-xs)',color:'var(--err)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
          title={q.reason}>{q.reason}</td>
        <td>
          <div className="row gap-sm">
            <button className="btn sm" onClick={showDetail} disabled={loadingDetail}>
              {loadingDetail ? '…' : detail ? 'Ukryj' : 'Szczegóły'}
            </button>
            {q.status==='hold'
              ? <button className="btn sm" onClick={()=>onAction(q.id,'release')}>Release</button>
              : <button className="btn sm" onClick={()=>onAction(q.id,'hold')}>Hold</button>
            }
            <button className="btn sm" onClick={()=>onAction(q.id,'delete')} title="Usuń">
              <Icon name="trash" size={11}/>
            </button>
          </div>
        </td>
      </tr>
      {detail && (
        <tr>
          <td colSpan={8} style={{padding:0}}>
            <pre style={{
              margin:0, padding:'10px 14px',
              background:'var(--bg)', color:'var(--fg-muted)',
              fontSize:10, fontFamily:'var(--font-mono)',
              lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-all',
              borderTop:'1px solid var(--line)', maxHeight:300, overflow:'auto',
            }}>{detail}</pre>
          </td>
        </tr>
      )}
    </>
  );
};

const MailVolumeChart = ({ hourly }) => {
  if (!hourly || !hourly.length) return null;
  const w=800, h=180, pl=36, pr=14, pt=14, pb=24;
  const max = Math.max(...hourly.flatMap(d=>[d.in||0,d.out||0,d.spam||0]), 1) + 5;
  const bw = (w-pl-pr)/24 * 0.78;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:180}} preserveAspectRatio="none">
      {[0,0.25,0.5,0.75,1].map(p=>{
        const y = h-pb-p*(h-pt-pb);
        return <g key={p}>
          <line x1={pl} x2={w-pr} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4"/>
          <text x={pl-4} y={y+3} fontSize="9" fill="var(--fg-dim)" textAnchor="end" fontFamily="var(--font-mono)">{Math.round(max*p)}</text>
        </g>;
      })}
      {hourly.map((d,i)=>{
        const x0 = pl + (i+0.1)*((w-pl-pr)/24);
        const hI = ((d.in||0)/max)*(h-pt-pb);
        const hO = ((d.out||0)/max)*(h-pt-pb);
        const hS = ((d.spam||0)/max)*(h-pt-pb);
        return (
          <g key={i}>
            <rect x={x0}         y={h-pb-hI} width={bw/3} height={hI} fill="var(--accent)" rx="1"/>
            <rect x={x0+bw/3}   y={h-pb-hO} width={bw/3} height={hO} fill="var(--ok)" rx="1"/>
            <rect x={x0+bw/3*2} y={h-pb-hS} width={bw/3} height={hS} fill="var(--err)" opacity="0.7" rx="1"/>
            {i%3===0 && <text x={x0+bw/2} y={h-8} fontSize="9" fill="var(--fg-dim)" textAnchor="middle" fontFamily="var(--font-mono)">{String(d.hr).padStart(2,'0')}</text>}
          </g>
        );
      })}
    </svg>
  );
};

const MailServer = () => {
  const [tab,  setTab]  = React.useState('overview');
  const [data, setData] = React.useState(null);
  const [cfg,  setCfg]  = React.useState(null);
  const [domains,  setDomains]  = React.useState([]);
  const [accounts, setAccounts] = React.useState([]);
  const [loading,  setLoading]  = React.useState(true);
  const [busy, setBusy] = React.useState('');
  const [installing, setInstalling] = React.useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/mail/status', { credentials:'include' });
      if (!r.ok) return;
      setData(await r.json());
    } catch(e) {}
    finally { setLoading(false); }
  };

  const loadDomains = () =>
    fetch('/api/mail/domains', { credentials:'include' })
      .then(r=>r.ok?r.json():null).then(d=>d&&setDomains(d.domains||[])).catch(()=>{});

  const loadAccounts = () =>
    fetch('/api/mail/accounts', { credentials:'include' })
      .then(r=>r.ok?r.json():null).then(d=>d&&setAccounts(d.accounts||[])).catch(()=>{});

  const loadConfig = () =>
    fetch('/api/mail/config', { credentials:'include' })
      .then(r=>r.ok?r.json():null).then(d=>d&&setCfg(d)).catch(()=>{});

  React.useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (tab === 'domains')  loadDomains();
    if (tab === 'accounts') loadAccounts();
    if (tab === 'config')   loadConfig();
  }, [tab]);

  const serviceAction = async (service, action) => {
    setBusy(service+'.'+action);
    try {
      await fetch('/api/mail/service', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ service, action }),
      });
      await load();
    } finally { setBusy(''); }
  };

  const queueAction = async (id, action) => {
    await fetch('/api/mail/queue/action', {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id, action }),
    });
    await load();
  };

  const queueFlush = async () => {
    setBusy('flush');
    try {
      await fetch('/api/mail/queue/flush', { method:'POST', credentials:'include' });
      await load();
    } finally { setBusy(''); }
  };

  const install = async () => {
    setInstalling(true);
    try {
      await fetch('/api/mail/install', { method:'POST', credentials:'include' });
      await load();
    } finally { setInstalling(false); }
  };

  if (loading) return (
    <div style={{padding:60,textAlign:'center',color:'var(--fg-dim)'}}>
      <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',
        borderRadius:'50%',animation:'_spin .6s linear infinite',margin:'0 auto 12px'}}/>
      <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}>Sprawdzanie serwera poczty…</div>
    </div>
  );

  // Postfix nie zainstalowany
  if (data && !data.postfix_installed) return (
    <div className="card" style={{padding:48,textAlign:'center'}}>
      <Icon name="bell" size={48} style={{opacity:.2,display:'block',margin:'0 auto 20px'}}/>
      <div style={{fontWeight:700,fontSize:'var(--fs-lg)',marginBottom:10}}>Serwer poczty nie jest zainstalowany</div>
      <div style={{color:'var(--fg-muted)',fontSize:'var(--fs-sm)',maxWidth:480,margin:'0 auto 24px',lineHeight:1.7}}>
        Zainstaluj Postfix + Dovecot + SpamAssassin + ClamAV aby uruchomić serwer poczty.
      </div>
      <button className="btn primary" onClick={install} disabled={installing} style={{padding:'9px 28px'}}>
        {installing ? 'Instalowanie…' : 'Zainstaluj Postfix + Dovecot'}
      </button>
    </div>
  );

  const stats = data?.stats || {};
  const queue = data?.queue || [];
  const deferred = queue.filter(q=>q.status==='deferred').length;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* KPI */}
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">POSTFIX</div>
          <div className="kpi-value" style={{fontSize:18,color:data?.postfix?'var(--ok)':'var(--err)'}}>
            {data?.postfix?'ONLINE':'STOP'}
          </div>
          <div className="kpi-foot">
            <span>SMTP · 25 · 465 · 587</span>
            <button className="btn sm" style={{marginLeft:8}}
              onClick={()=>serviceAction('postfix', data?.postfix?'restart':'start')}
              disabled={busy==='postfix.restart'||busy==='postfix.start'}>
              {data?.postfix ? <><Icon name="refresh" size={10}/> Restart</> : '▶ Start'}
            </button>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">DOVECOT</div>
          <div className="kpi-value" style={{fontSize:18,color:data?.dovecot?'var(--ok)':'var(--err)'}}>
            {data?.dovecot?'ONLINE':'STOP'}
          </div>
          <div className="kpi-foot">
            <span>IMAP · 143 · 993</span>
            <button className="btn sm" style={{marginLeft:8}}
              onClick={()=>serviceAction('dovecot', data?.dovecot?'restart':'start')}
              disabled={busy==='dovecot.restart'||busy==='dovecot.start'}>
              {data?.dovecot ? <><Icon name="refresh" size={10}/> Restart</> : '▶ Start'}
            </button>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">KOLEJKA</div>
          <div className="kpi-value" style={{color: deferred>0?'var(--warn)':'var(--fg)'}}>
            {data?.queue_total ?? 0}
          </div>
          <div className="kpi-foot"><span>{deferred} deferred</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">DOSTARCZALNOŚĆ 24h</div>
          <div className="kpi-value" style={{color:'var(--ok)'}}>
            {stats.delivery_rate ?? '—'}{stats.delivery_rate != null ? '%' : ''}
          </div>
          <div className="kpi-foot"><span>{stats.sent ?? 0} wysłanych</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="segmented">
        {[
          ['overview','Przegląd'],['queue',`Kolejka (${data?.queue_total??0})`],
          ['domains','Domeny'],['accounts','Konta'],
          ['dns','DNS / Aliasy'],['spam','Spam / Antywirus'],['config','Konfiguracja'],
        ].map(([id,l])=>(
          <button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{l}</button>
        ))}
      </div>

      {/* ── PRZEGLĄD ── */}
      {tab==='overview' && (
        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Ruch poczty · ostatnie 24h</div><div className="card-sub">Wiadomości · logi Postfix</div></div>
              <div style={{display:'flex',gap:14,fontSize:'var(--fs-xs)'}}>
                <span><span style={{display:'inline-block',width:10,height:10,background:'var(--accent)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}/>Odebrane</span>
                <span><span style={{display:'inline-block',width:10,height:10,background:'var(--ok)',borderRadius:2,marginRight:4,verticalAlign:'middle'}}/>Wysłane</span>
                <span><span style={{display:'inline-block',width:10,height:10,background:'var(--err)',opacity:.7,borderRadius:2,marginRight:4,verticalAlign:'middle'}}/>Spam</span>
              </div>
            </div>
            <div style={{padding:'8px var(--pad-card) 4px'}}>
              {data?.hourly
                ? <MailVolumeChart hourly={data.hourly}/>
                : <div style={{height:180,display:'grid',placeItems:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
                    Dane godzinowe niedostępne (wymaga pflogsumm)
                  </div>
              }
            </div>
          </div>

          <div className="grid grid-3">
            <div className="card">
              <div className="card-head"><div><div className="card-title">Odebrane 24h</div></div></div>
              <div style={{padding:'14px var(--pad-card)',fontSize:32,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--accent)'}}>{stats.received??0}</div>
              <div style={{padding:'0 var(--pad-card) 14px',fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
                <div>czyste: <b style={{color:'var(--ok)'}}>{stats.clean??0}</b></div>
                <div>spam: <b style={{color:'var(--err)'}}>{stats.spam??0}</b></div>
                <div>wirusy: <b style={{color:'var(--err)'}}>{stats.virus??0}</b></div>
                <div>odrzucone: <b style={{color:'var(--warn)'}}>{stats.rejected??0}</b></div>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Wysłane 24h</div></div></div>
              <div style={{padding:'14px var(--pad-card)',fontSize:32,fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--ok)'}}>{stats.sent??0}</div>
              <div style={{padding:'0 var(--pad-card) 14px',fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
                <div>bounce: <b style={{color:'var(--warn)'}}>{stats.bounce??0}</b></div>
                <div>deferred: <b style={{color:'var(--warn)'}}>{stats.deferred??0}</b></div>
                <div>dostarczone: <b style={{color:'var(--ok)'}}>{(stats.sent??0)-(stats.bounce??0)-(stats.deferred??0)}</b></div>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><div><div className="card-title">Status usług</div></div></div>
              <div className="card-body col" style={{gap:10}}>
                {[
                  ['Postfix (SMTP)',      data?.postfix,      'postfix'],
                  ['Dovecot (IMAP)',      data?.dovecot,      'dovecot'],
                  ['SpamAssassin',        data?.spamassassin, 'spamassassin'],
                  ['ClamAV',             data?.clamav,       'clamav-daemon'],
                ].map(([name, active, svc])=>(
                  <div key={name} style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <span style={{fontSize:'var(--fs-xs)'}}>{name}</span>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span className={'badge '+(active?'ok':'err')}>{active?'UP':'DOWN'}</span>
                      <button className="btn sm"
                        onClick={()=>serviceAction(svc, active?'stop':'start')}
                        disabled={!!busy}>
                        {active?'Stop':'Start'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── KOLEJKA ── */}
      {tab==='queue' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Kolejka poczty</div><div className="card-sub">postqueue -p · {queue.length} wiadomości · {deferred} deferred</div></div>
            <div className="card-actions">
              <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/> Odśwież</button>
              <button className="btn sm primary" onClick={queueFlush} disabled={busy==='flush'}>
                <Icon name="play" size={11}/> {busy==='flush'?'Flushing…':'Flush queue'}
              </button>
            </div>
          </div>
          {queue.length === 0 ? (
            <div style={{padding:32,textAlign:'center',color:'var(--ok)',fontSize:'var(--fs-sm)'}}>
              ✓ Kolejka poczty jest pusta
            </div>
          ) : (
            <table className="table">
              <thead><tr><th>Queue ID</th><th>Od</th><th>Do</th><th>Rozmiar</th><th>Czas</th><th>Status</th><th>Powód</th><th></th></tr></thead>
              <tbody>{queue.map(q=><QueueRow key={q.id} q={q} onAction={queueAction}/>)}</tbody>
            </table>
          )}
        </div>
      )}

      {/* ── DOMENY ── */}
      {tab==='domains' && (
        <MailDomainsTab domains={domains} onReload={loadDomains}/>
      )}

      {/* ── KONTA ── */}
      {tab==='accounts' && (
        <MailAccountsTab accounts={accounts} onReload={loadAccounts}/>
      )}

      {/* ── DNS ── */}
      {tab==='dns' && <MailDNSPanel/>}

      {/* ── SPAM / ANTYWIRUS ── */}
      {tab==='spam' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <div><div className="card-title">SpamAssassin</div><div className="card-sub">amavisd-new + ClamAV</div></div>
              <div className="card-actions">
                <span className={'badge '+(data?.spamassassin?'ok':'err')}>{data?.spamassassin?'UP':'DOWN'}</span>
                <button className="btn sm" onClick={()=>serviceAction('spamassassin', data?.spamassassin?'stop':'start')}>
                  {data?.spamassassin?'Stop':'Start'}
                </button>
              </div>
            </div>
            <div className="card-body col" style={{gap:10,fontSize:'var(--fs-sm)'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[['Próg spam','5.0'],['Próg odrzucenia','8.0'],['Baza reguł','SARE + Pyzor'],['Bayes','aktywny']].map(([k,v])=>(
                  <div key={k}>
                    <div style={{fontSize:10,color:'var(--fg-dim)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>{k}</div>
                    <div className="mono">{v}</div>
                  </div>
                ))}
              </div>
              <hr className="div"/>
              <div><b>ClamAV:</b> <span className={'badge '+(data?.clamav?'ok':'err')} style={{marginLeft:6}}>{data?.clamav?'UP':'DOWN'}</span>
                <button className="btn sm" style={{marginLeft:8}} onClick={()=>serviceAction('clamav-daemon', data?.clamav?'stop':'start')}>
                  {data?.clamav?'Stop':'Start'}
                </button>
              </div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>
                <b>RBL:</b> zen.spamhaus.org, bl.spamcop.net<br/>
                <b>Greylisting:</b> postgrey · opóźnienie 5 min
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-title">Statystyki spam · 24h</div></div></div>
            <div className="card-body col" style={{gap:12}}>
              {[
                ['Wykryty spam',       stats.spam||0,     'var(--err)'],
                ['Wirusy (ClamAV)',    stats.virus||0,    'var(--err)'],
                ['Odrzucone na SMTP',  stats.rejected||0, 'var(--warn)'],
                ['Czyste',             stats.clean||0,    'var(--ok)'],
              ].map(([k,v,col])=>{
                const total = (stats.spam||0)+(stats.virus||0)+(stats.rejected||0)+(stats.clean||0);
                const pct = total>0 ? (v/total)*100 : 0;
                return (
                  <div key={k}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:4,fontSize:'var(--fs-sm)'}}>
                      <span>{k}</span>
                      <span className="mono" style={{color:col,fontWeight:600}}>{v} <span style={{color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>({pct.toFixed(1)}%)</span></span>
                    </div>
                    <div style={{height:6,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',width:pct+'%',background:col,borderRadius:3}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── KONFIGURACJA ── */}
      {tab==='config' && (
        <MailConfigEditor onReload={load}/>
      )}
    </div>
  );
};

window.MailServer = MailServer;

// ===== Edytor konfiguracji Postfix =====

const SMTP_PROFILES = [
  { id:'gmail',    label:'Gmail',        relay:'[smtp.gmail.com]:587',    hint:'Użyj hasła aplikacji (2FA wymagane)' },
  { id:'o2',       label:'O2 / Onet',    relay:'[smtp.o2.pl]:587',        hint:'Login: pełny adres email' },
  { id:'wp',       label:'WP.pl',        relay:'[smtp.wp.pl]:587',        hint:'Login: pełny adres email' },
  { id:'interia',  label:'Interia',      relay:'[smtp.interia.pl]:587',   hint:'Login: pełny adres email' },
  { id:'sendgrid', label:'SendGrid',     relay:'[smtp.sendgrid.net]:587', hint:'Login: apikey, hasło: klucz API' },
  { id:'local',    label:'Lokalnie (bez relay)', relay:'',                hint:'Bezpośrednie wysyłanie — może być blokowane przez ISP' },
];

const POSTFIX_FIELDS = [
  { key:'myhostname',   label:'Hostname serwera',  hint:'FQDN serwera, np. mail.example.com', example:'mail.example.com' },
  { key:'myorigin',     label:'Domena nadawcy',    hint:'Zastępuje @debian w adresie From', example:'example.com' },
  { key:'mydomain',     label:'Domena lokalna',    hint:'Zwykle to samo co myorigin', example:'example.com' },
  { key:'relayhost',    label:'Relay SMTP',        hint:'Serwer przez który wysyłasz, np. [smtp.gmail.com]:587', example:'[smtp.gmail.com]:587' },
  { key:'inet_interfaces', label:'Interfejsy nasłuchu', hint:'all = nasłuchuj na wszystkich', example:'all' },
  { key:'mynetworks',   label:'Zaufane sieci',     hint:'Sieci które mogą wysyłać bez auth', example:'127.0.0.0/8 192.168.0.0/24' },
  { key:'message_size_limit', label:'Max rozmiar wiadomości', hint:'W bajtach. 0 = brak limitu', example:'52428800' },
];

const MailConfigEditor = ({ onReload }) => {
  const [pfCfg,    setPfCfg]    = React.useState({});
  const [loading,  setLoading]  = React.useState(true);
  const [saving,   setSaving]   = React.useState('');
  const [profile,  setProfile]  = React.useState('gmail');
  const [relayUser, setRelayUser]   = React.useState('');
  const [relayPass, setRelayPass]   = React.useState('');
  const [hostname,  setHostname]    = React.useState('');
  const [domain,    setDomain]      = React.useState('');
  const [showPass,  setShowPass]    = React.useState(false);
  const [applyMsg,  setApplyMsg]    = React.useState('');

  const [diag, setDiag] = React.useState(null);
  const [fixing, setFixing] = React.useState(false);
  const [fixMsg, setFixMsg] = React.useState('');

  React.useEffect(() => {
    Promise.all([
      fetch('/api/mail/postfix/config', { credentials:'include' }).then(r => r.ok ? r.json() : null),
      fetch('/api/mail/postfix/diag',   { credentials:'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([cfgData, diagData]) => {
      if (cfgData?.config) {
        setPfCfg(cfgData.config);
        const h = cfgData.config.myhostname || '';
        const o = cfgData.config.myorigin   || '';
        if (h && h !== '$myhostname' && h.includes('.')) setHostname(h);
        if (o && o !== '$myhostname' && o.includes('.')) setDomain(o);
      }
      if (diagData) setDiag(diagData);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const quickFix = async () => {
    setFixing(true); setFixMsg('');
    try {
      const r = await fetch('/api/mail/postfix/fix', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ hostname, domain }),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        setFixMsg('✅ Naprawiono: ' + (d.fixed || []).join(', '));
        // Odśwież diagnostykę
        const r2 = await fetch('/api/mail/postfix/diag', { credentials:'include' });
        setDiag(await r2.json());
        const r3 = await fetch('/api/mail/postfix/config', { credentials:'include' });
        const d3 = await r3.json();
        if (d3.config) setPfCfg(d3.config);
      }
    } catch(e) { setFixMsg('❌ Błąd'); }
    finally { setFixing(false); }
  };

  const setKey = async (key, value) => {
    setSaving(key);
    try {
      await fetch('/api/mail/postfix/config', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ key, value }),
      });
      setPfCfg(c => ({...c, [key]: value}));
    } finally { setSaving(''); }
  };

  const applyProfile = async () => {
    setSaving('profile');
    setApplyMsg('');
    try {
      const r = await fetch('/api/mail/postfix/profile', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          profile, hostname, domain,
          user: relayUser, password: relayPass,
        }),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        setApplyMsg('✅ Konfiguracja zastosowana! Postfix przeładowany i kolejka wznowiona.');
        onReload && onReload();
        // Odśwież konfigurację
        const r2 = await fetch('/api/mail/postfix/config', { credentials:'include' });
        const d2 = await r2.json();
        if (d2.config) setPfCfg(d2.config);
      } else {
        setApplyMsg('❌ Błąd: ' + (d.error || 'nieznany'));
      }
    } catch(e) { setApplyMsg('❌ Błąd połączenia'); }
    finally { setSaving(''); }
  };

  const selectedProfile = SMTP_PROFILES.find(p => p.id === profile);

  if (loading) return <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Ładowanie konfiguracji…</div>;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* Diagnostyka Postfix */}
      {diag?.has_issues && (
        <div style={{padding:'14px 16px',background:'oklch(0.66 0.2 25/0.08)',border:'1px solid oklch(0.66 0.2 25/0.3)',borderRadius:8}}>
          <div style={{display:'flex',gap:12,alignItems:'flex-start',marginBottom:10}}>
            <Icon name="thermometer" size={16} style={{color:'var(--err)',flexShrink:0,marginTop:2}}/>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:4}}>Problemy z konfiguracją Postfix</div>
              {diag.issues.map((issue,i) => (
                <div key={i} style={{fontSize:'var(--fs-xs)',color:'var(--err)',fontFamily:'var(--font-mono)',marginBottom:2}}>• {issue}</div>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)',flex:1}}>
              Wypełnij Hostname i Domenę poniżej, a następnie kliknij "Napraw teraz" — skrypt poprawi main.cf i usunie bounced wiadomości.
            </div>
            <button className="btn primary" onClick={quickFix}
              disabled={fixing}>
              {fixing ? 'Naprawianie…' : '🔧 Napraw teraz'}
            </button>
          </div>
          {fixMsg && <div style={{marginTop:8,fontSize:'var(--fs-xs)',color: fixMsg.startsWith('✅')?'var(--ok)':'var(--err)'}}>{fixMsg}</div>}
        </div>
      )}
      {fixMsg && !diag?.has_issues && (
        <div style={{padding:'10px 14px',background:'color-mix(in oklch,var(--ok) 8%,transparent)',border:'1px solid color-mix(in oklch,var(--ok) 25%,transparent)',borderRadius:8,fontSize:'var(--fs-sm)',color:'var(--ok)'}}>
          {fixMsg}
        </div>
      )}

      {/* Kreator szybkiej konfiguracji SMTP relay */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Kreator konfiguracji SMTP relay</div>
            <div className="card-sub">Wybierz dostawcę i wprowadź dane logowania — skonfiguruje Postfix automatycznie</div>
          </div>
        </div>
        <div className="card-body col" style={{gap:16}}>

          {/* Profil dostawcy */}
          <div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.06em'}}>Dostawca SMTP</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {SMTP_PROFILES.map(p => (
                <button key={p.id}
                  onClick={() => setProfile(p.id)}
                  style={{
                    padding:'7px 14px', borderRadius:7, border:'1px solid', cursor:'pointer', fontSize:'var(--fs-sm)',
                    borderColor: profile===p.id ? 'var(--accent)' : 'var(--line-strong)',
                    background: profile===p.id ? 'color-mix(in oklch,var(--accent) 12%,var(--bg-2))' : 'var(--bg-2)',
                    color: profile===p.id ? 'var(--accent)' : 'var(--fg)',
                  }}>{p.label}</button>
              ))}
            </div>
            {selectedProfile?.hint && (
              <div style={{marginTop:8,fontSize:'var(--fs-xs)',color:'var(--accent)',padding:'6px 10px',background:'color-mix(in oklch,var(--accent) 6%,transparent)',borderRadius:6}}>
                💡 {selectedProfile.hint}
                {selectedProfile.relay && <span style={{marginLeft:8,color:'var(--fg-dim)'}}>Relay: <code>{selectedProfile.relay}</code></span>}
              </div>
            )}
          </div>

          {/* Hostname i domena */}
          <div className="grid grid-2">
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>
                Hostname serwera <span style={{color:'var(--err)'}}>*</span>
                <span style={{color:'var(--fg-dim)',marginLeft:6}}>np. mail.example.com</span>
              </div>
              <input className="input" value={hostname} onChange={e=>setHostname(e.target.value)}
                placeholder="mail.example.com" style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>
                Domena nadawcy <span style={{color:'var(--err)'}}>*</span>
                <span style={{color:'var(--fg-dim)',marginLeft:6}}>np. example.com</span>
              </div>
              <input className="input" value={domain} onChange={e=>setDomain(e.target.value)}
                placeholder="example.com" style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
            </div>
          </div>

          {/* Dane logowania SMTP */}
          {profile !== 'local' && (
            <div className="grid grid-2">
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6}}>Login SMTP</div>
                <input className="input" value={relayUser} onChange={e=>setRelayUser(e.target.value)}
                  placeholder="user@example.com" style={{width:'100%'}}/>
              </div>
              <div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6,display:'flex',justifyContent:'space-between'}}>
                  <span>Hasło SMTP</span>
                  <span style={{cursor:'pointer',color:'var(--accent)'}} onClick={()=>setShowPass(s=>!s)}>{showPass?'Ukryj':'Pokaż'}</span>
                </div>
                <input className="input" type={showPass?'text':'password'} value={relayPass}
                  onChange={e=>setRelayPass(e.target.value)}
                  placeholder={profile==='sendgrid'?'klucz API...':'hasło aplikacji...'}
                  style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
              </div>
            </div>
          )}

          {applyMsg && (
            <div style={{padding:'8px 12px',borderRadius:6,fontSize:'var(--fs-sm)',
              background: applyMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 8%,transparent)' : 'color-mix(in oklch,var(--err) 8%,transparent)',
              border: '1px solid ' + (applyMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 25%,transparent)' : 'color-mix(in oklch,var(--err) 25%,transparent)'),
            }}>{applyMsg}</div>
          )}

          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            <button className="btn primary" onClick={applyProfile}
              disabled={saving==='profile' || !hostname || !domain || (profile!=='local' && (!relayUser||!relayPass))}
              style={{padding:'8px 24px'}}>
              {saving==='profile' ? 'Stosowanie…' : '⚡ Zastosuj konfigurację i wyślij kolejkę'}
            </button>
            <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
              Zmodyfikuje main.cf, przeładuje Postfix i wznowi kolejkę
            </span>
          </div>
        </div>
      </div>

      {/* Szczegółowa edycja kluczy */}
      <div className="card">
        <div className="card-head">
          <div><div className="card-title">Zaawansowane — main.cf</div><div className="card-sub">Aktualna konfiguracja Postfix · zmiany stosowane natychmiast</div></div>
          <button className="btn sm" onClick={()=>serviceAction&&serviceAction('postfix','reload')}>Reload</button>
        </div>
        <div style={{padding:'4px 0'}}>
          {POSTFIX_FIELDS.map((f,i) => (
            <ConfigRow key={f.key} field={f} value={pfCfg[f.key]||''} saving={saving===f.key} onSave={setKey}
              style={{borderTop: i>0?'1px solid var(--line)':'none'}}/>
          ))}
        </div>
      </div>
    </div>
  );
};

const ConfigRow = ({ field, value, saving, onSave, style }) => {
  const [local, setLocal] = React.useState(value);
  const [changed, setChanged] = React.useState(false);

  React.useEffect(() => { setLocal(value); setChanged(false); }, [value]);

  return (
    <div style={{padding:'10px var(--pad-card)',display:'grid',gridTemplateColumns:'220px 1fr auto',...style,gap:12,alignItems:'start'}}>
      <div>
        <div style={{fontWeight:500,fontSize:'var(--fs-sm)',fontFamily:'var(--font-mono)'}}>{field.key}</div>
        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2}}>{field.label}</div>
      </div>
      <div>
        <input className="input" value={local}
          onChange={e => { setLocal(e.target.value); setChanged(e.target.value !== value); }}
          onKeyDown={e => e.key==='Enter' && changed && onSave(field.key, local)}
          placeholder={field.example}
          style={{width:'100%',fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)'}}/>
        <div style={{fontSize:10,color:'var(--fg-dim)',marginTop:3}}>{field.hint}</div>
      </div>
      <button className="btn sm primary" onClick={()=>onSave(field.key,local)}
        disabled={!changed||saving} style={{marginTop:2,whiteSpace:'nowrap'}}>
        {saving ? '…' : 'Zapisz'}
      </button>
    </div>
  );
};

// ── MailDomainsTab ────────────────────────────────────────────────────────────
const MailDomainsTab = ({ domains, onReload }) => {
  const [newDomain, setNewDomain] = React.useState('');
  const [adding,    setAdding]    = React.useState(false);
  const [showForm,  setShowForm]  = React.useState(false);
  const [deleting,  setDeleting]  = React.useState('');
  const [err,       setErr]       = React.useState('');

  const addDomain = async () => {
    const name = newDomain.trim().toLowerCase();
    if (!name || !name.includes('.')) { setErr('Podaj prawidłową nazwę domeny, np. example.com'); return; }
    setAdding(true); setErr('');
    try {
      const r = await fetch('/api/mail/domains', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name }),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        setNewDomain(''); setShowForm(false);
        onReload();
      } else {
        setErr(d.error || 'Błąd dodawania domeny');
      }
    } catch(e) { setErr('Błąd połączenia'); }
    finally { setAdding(false); }
  };

  const deleteDomain = async (name) => {
    setDeleting(name);
    try {
      await fetch(`/api/mail/domains/${name}`, { method:'DELETE', credentials:'include' });
      onReload();
    } finally { setDeleting(''); }
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {/* Formularz dodawania */}
      {showForm ? (
        <div className="card" style={{padding:'16px var(--pad-card)'}}>
          <div style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:12}}>Dodaj domenę pocztową</div>
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
            <div style={{flex:1}}>
              <input className="input" value={newDomain}
                onChange={e => { setNewDomain(e.target.value); setErr(''); }}
                onKeyDown={e => e.key==='Enter' && addDomain()}
                placeholder="example.com"
                autoFocus
                style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
              {err && <div style={{color:'var(--err)',fontSize:'var(--fs-xs)',marginTop:5}}>{err}</div>}
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:4}}>
                Domena zostanie dodana do virtual_mailbox_domains w Postfixie
              </div>
            </div>
            <button className="btn primary" onClick={addDomain} disabled={adding || !newDomain.trim()}>
              {adding ? 'Dodawanie…' : 'Dodaj'}
            </button>
            <button className="btn" onClick={() => { setShowForm(false); setNewDomain(''); setErr(''); }}>
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn sm" onClick={onReload}><Icon name="refresh" size={11}/></button>
          <button className="btn sm primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={11}/> Dodaj domenę
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Domeny pocztowe</div>
            <div className="card-sub">virtual_mailbox_domains · {domains.length} domen</div>
          </div>
        </div>
        {domains.length === 0 ? (
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            Brak skonfigurowanych domen. Kliknij "Dodaj domenę" aby dodać pierwszą.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Domena</th><th>Konta</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {domains.map(d => (
                <tr key={d.name}>
                  <td className="mono" style={{fontWeight:600}}>{d.name}</td>
                  <td className="mono">{d.accounts || 0}</td>
                  <td>
                    {d.active
                      ? <span className="badge ok">aktywna</span>
                      : <span className="badge">wyłączona</span>
                    }
                  </td>
                  <td>
                    <button className="icon-btn"
                      disabled={deleting === d.name}
                      onClick={() => deleteDomain(d.name)}
                      title={`Usuń domenę ${d.name}`}>
                      {deleting === d.name
                        ? <span style={{fontSize:10}}>…</span>
                        : <Icon name="trash" size={13}/>
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ── MailAccountsTab ───────────────────────────────────────────────────────────
const MailAccountsTab = ({ accounts, onReload }) => {
  const [showForm,  setShowForm]  = React.useState(false);
  const [addr,      setAddr]      = React.useState('');
  const [pass,      setPass]      = React.useState('');
  const [showPass,  setShowPass]  = React.useState(false);
  const [adding,    setAdding]    = React.useState(false);
  const [deleting,  setDeleting]  = React.useState('');
  const [err,       setErr]       = React.useState('');
  const [setupMsg,  setSetupMsg]  = React.useState('');
  const [settingUp, setSettingUp] = React.useState(false);

  const setupDovecot = async () => {
    setSettingUp(true); setSetupMsg('');
    try {
      const r = await fetch('/api/mail/dovecot/setup', { method:'POST', credentials:'include' });
      const d = await r.json();
      if (d.status === 'ok') {
        setSetupMsg('✅ Dovecot skonfigurowany! ' + (d.fixed||[]).join(' · '));
      } else {
        setSetupMsg('❌ ' + (d.error || 'błąd'));
      }
    } catch(e) { setSetupMsg('❌ Błąd połączenia'); }
    finally { setSettingUp(false); }
  };

  const addAccount = async () => {
    const a = addr.trim();
    if (!a.includes('@') || !a.includes('.')) { setErr('Podaj prawidłowy adres email'); return; }
    if (pass.length < 6) { setErr('Hasło musi mieć co najmniej 6 znaków'); return; }
    setAdding(true); setErr('');
    try {
      const r = await fetch('/api/mail/accounts', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ addr: a, password: pass, max_gb: 10 }),
      });
      const d = await r.json();
      if (d.status === 'ok') {
        setAddr(''); setPass(''); setShowForm(false);
        onReload();
      } else {
        setErr(d.error || 'Błąd dodawania konta');
      }
    } catch(e) { setErr('Błąd połączenia'); }
    finally { setAdding(false); }
  };

  const deleteAccount = async (a) => {
    setDeleting(a);
    try {
      await fetch(`/api/mail/accounts/${encodeURIComponent(a)}`, { method:'DELETE', credentials:'include' });
      onReload();
    } finally { setDeleting(''); }
  };

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      {showForm ? (
        <div className="card" style={{padding:'16px var(--pad-card)'}}>
          <div style={{fontWeight:600,fontSize:'var(--fs-sm)',marginBottom:12}}>Dodaj konto pocztowe</div>
          <div className="grid grid-2" style={{gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5}}>Adres e-mail</div>
              <input className="input" value={addr}
                onChange={e => { setAddr(e.target.value); setErr(''); }}
                placeholder="user@example.com"
                autoFocus
                style={{width:'100%'}}/>
            </div>
            <div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:5,display:'flex',justifyContent:'space-between'}}>
                <span>Hasło</span>
                <span style={{cursor:'pointer',color:'var(--accent)'}} onClick={() => setShowPass(s=>!s)}>
                  {showPass ? 'Ukryj' : 'Pokaż'}
                </span>
              </div>
              <input className="input" type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={e => { setPass(e.target.value); setErr(''); }}
                onKeyDown={e => e.key==='Enter' && addAccount()}
                placeholder="min. 6 znaków"
                style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
            </div>
          </div>
          {err && <div style={{color:'var(--err)',fontSize:'var(--fs-xs)',marginBottom:8}}>{err}</div>}
          <div style={{display:'flex',gap:8}}>
            <button className="btn primary" onClick={addAccount} disabled={adding || !addr || !pass}>
              {adding ? 'Tworzenie…' : 'Utwórz konto'}
            </button>
            <button className="btn" onClick={() => { setShowForm(false); setAddr(''); setPass(''); setErr(''); }}>
              Anuluj
            </button>
          </div>
        </div>
      ) : (
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn sm" onClick={onReload}><Icon name="refresh" size={11}/></button>
          <button className="btn sm primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={11}/> Dodaj konto
          </button>
        </div>
      )}

      {setupMsg && (
        <div style={{padding:'10px 14px',borderRadius:8,fontSize:'var(--fs-sm)',
          background: setupMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 8%,transparent)' : 'color-mix(in oklch,var(--err) 8%,transparent)',
          border: '1px solid ' + (setupMsg.startsWith('✅') ? 'color-mix(in oklch,var(--ok) 25%,transparent)' : 'color-mix(in oklch,var(--err) 25%,transparent)'),
        }}>{setupMsg}</div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Konta pocztowe</div>
            <div className="card-sub">Dovecot · {accounts.length} kont</div>
          </div>
          <div className="card-actions">
            <button className="btn sm" onClick={setupDovecot} disabled={settingUp}
              title="Skonfiguruj Dovecot żeby używał /etc/dovecot/users (naprawia błąd Authentication failed)">
              {settingUp ? '…' : '⚙ Skonfiguruj Dovecot auth'}
            </button>
          </div>
        </div>
        {accounts.length === 0 ? (
          <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            Brak kont lub doveadm niedostępny
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Adres</th><th style={{width:220}}>Quota</th><th>Wiad.</th><th>Aktywność</th><th></th></tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const pct = a.max > 0 ? Math.min(100, (a.quota / a.max) * 100) : 0;
                const col = pct > 85 ? 'var(--err)' : pct > 65 ? 'var(--warn)' : 'var(--ok)';
                return (
                  <tr key={a.addr}>
                    <td className="mono" style={{fontWeight:500}}>{a.addr}</td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{flex:1,height:5,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                          <div style={{height:'100%',width:pct+'%',background:col,borderRadius:3}}/>
                        </div>
                        <span className="mono" style={{fontSize:'var(--fs-xs)',color:col,minWidth:80,textAlign:'right'}}>
                          {a.quota} / {a.max} GB
                        </span>
                      </div>
                    </td>
                    <td className="mono">{a.boxes || 0}</td>
                    <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{a.last || '—'}</td>
                    <td>
                      <div className="row gap-sm">
                        <button className="btn sm" title="Zmień hasło"
                          onClick={async () => {
                            const newPass = window.prompt(`Nowe hasło dla ${a.addr}:`);
                            if (!newPass || newPass.length < 6) return;
                            const r = await fetch('/api/mail/accounts/password', {
                              method:'POST', credentials:'include',
                              headers:{'Content-Type':'application/json'},
                              body: JSON.stringify({ addr: a.addr, password: newPass }),
                            });
                            const d = await r.json();
                            if (d.status === 'ok') alert('Hasło zmienione (' + d.hash_prefix + '...)');
                            else alert('Błąd: ' + (d.error || 'nieznany'));
                          }}>
                          Hasło
                        </button>
                        <button className="icon-btn"
                          disabled={deleting === a.addr}
                          onClick={() => deleteAccount(a.addr)}
                          title={`Usuń konto ${a.addr}`}>
                          {deleting === a.addr
                            ? <span style={{fontSize:10}}>…</span>
                            : <Icon name="trash" size={13}/>
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ── DNS Diagnostyka + Aliasy ──────────────────────────────────────────────────
const MailDNSPanel = () => {
  const [dns,     setDns]     = React.useState(null);
  const [aliases, setAliases] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [newFrom, setNewFrom] = React.useState('root');
  const [newTo,   setNewTo]   = React.useState('');
  const [saving,  setSaving]  = React.useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch('/api/mail/dns-diag', { credentials:'include' }).then(r=>r.ok?r.json():null),
      fetch('/api/mail/aliases',  { credentials:'include' }).then(r=>r.ok?r.json():null),
    ]).then(([d, a]) => {
      if (d) setDns(d);
      if (a) setAliases(a.aliases || []);
    }).finally(() => setLoading(false));
  };

  React.useEffect(() => { load(); }, []);

  const addAlias = async () => {
    if (!newFrom || !newTo) return;
    setSaving(true);
    try {
      await fetch('/api/mail/aliases', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ from: newFrom, to: newTo }),
      });
      setNewFrom('root'); setNewTo('');
      load();
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{padding:32,textAlign:'center',color:'var(--fg-dim)'}}>Sprawdzanie DNS…</div>;

  const spf    = dns?.spf || '';
  const dkim   = dns?.dkim || '';
  const mx     = dns?.mx || '';
  const ip     = dns?.server_ip || '';
  const ptr    = dns?.ptr || '';
  const domain = dns?.domain || '';

  const spfOK  = spf !== '';
  const dkimOK = dkim !== '';
  const mxOK   = mx !== '';
  const ptrOK  = ptr !== '' && !ptr.includes('localhost');
  const spfHasIP = dns?.spf_includes_ip;

  const allOK = spfOK && dkimOK && mxOK && spfHasIP;

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>

      {/* Status DNS */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Diagnostyka DNS · {domain}</div>
            <div className="card-sub">IP serwera: {ip || '?'} · PTR: {ptr || 'brak'}</div>
          </div>
          <button className="btn sm" onClick={load}><Icon name="refresh" size={11}/></button>
        </div>
        <div style={{padding:'4px 0'}}>
          {[
            {
              label: 'MX Record',
              ok: mxOK,
              value: mx || 'brak',
              fix: `Dodaj rekord MX w DNS: @ MX 10 mail.${domain}`,
            },
            {
              label: 'SPF Record',
              ok: spfOK && spfHasIP,
              value: spf || 'brak',
              fix: `Dodaj TXT w DNS: v=spf1 ip4:${ip} ~all`,
              warn: spfOK && !spfHasIP ? `SPF istnieje ale nie zawiera IP ${ip}` : null,
            },
            {
              label: 'DKIM Record',
              ok: dkimOK,
              value: dkim ? `${dns.dkim_selector}._domainkey OK` : 'brak',
              fix: 'Zainstaluj opendkim i dodaj rekord TXT _domainkey',
            },
            {
              label: 'PTR (Reverse DNS)',
              ok: ptrOK,
              value: ptr || 'brak',
              fix: 'Skontaktuj się z dostawcą internetu aby ustawili PTR dla IP '+ip,
            },
          ].map((item, i) => (
            <div key={item.label} style={{
              padding:'10px var(--pad-card)',
              borderTop: i > 0 ? '1px solid var(--line)' : 'none',
              display:'grid', gridTemplateColumns:'140px 1fr', gap:12, alignItems:'start',
            }}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{
                  width:8, height:8, borderRadius:'50%', flexShrink:0,
                  background: item.ok ? 'var(--ok)' : item.warn ? 'var(--warn)' : 'var(--err)',
                }}/>
                <span style={{fontSize:'var(--fs-sm)',fontWeight:500}}>{item.label}</span>
              </div>
              <div>
                <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',color:'var(--fg-muted)',marginBottom: item.ok?0:4}}>
                  {item.value}
                </div>
                {!item.ok && (
                  <div style={{fontSize:'var(--fs-xs)',color:'var(--warn)',marginTop:3}}>
                    {item.warn || `⚠ ${item.fix}`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {!allOK && (
          <div style={{
            margin:'0 var(--pad-card) var(--pad-card)',
            padding:'12px 14px', borderRadius:8,
            background:'oklch(0.66 0.2 25/0.06)',
            border:'1px solid oklch(0.66 0.2 25/0.25)',
            fontSize:'var(--fs-xs)', lineHeight:1.7,
          }}>
            <div style={{fontWeight:600,marginBottom:6,fontSize:'var(--fs-sm)'}}>
              ⚠ Gmail i inne serwery odrzucają Twoje maile — SPF/DKIM nie przechodzi
            </div>
            <div>
              <b>Najszybsze rozwiązanie:</b> użyj SMTP relay w zakładce Konfiguracja (Gmail, SendGrid) —
              wtedy SPF/DKIM nie jest wymagany bo wysyłasz przez ich serwery.
            </div>
            <div style={{marginTop:6}}>
              <b>Lub dodaj w panelu DNS domeny {domain}:</b>
            </div>
            {!spfOK && (
              <div style={{fontFamily:'var(--font-mono)',background:'var(--bg)',padding:'4px 8px',borderRadius:4,marginTop:4}}>
                TXT @ "v=spf1 ip4:{ip} ~all"
              </div>
            )}
            {spfOK && !spfHasIP && (
              <div style={{fontFamily:'var(--font-mono)',background:'var(--bg)',padding:'4px 8px',borderRadius:4,marginTop:4}}>
                Edytuj SPF: dodaj ip4:{ip} przed ~all
              </div>
            )}
          </div>
        )}
      </div>

      {/* Aliasy /etc/aliases */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Aliasy lokalne</div>
            <div className="card-sub">/etc/aliases · przekierowania poczty lokalnej (np. root → Twój email)</div>
          </div>
        </div>

        {/* Formularz dodawania */}
        <div style={{padding:'12px var(--pad-card)',borderBottom:'1px solid var(--line)',display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'}}>
          <div style={{flex:'0 0 120px'}}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Alias (od)</div>
            <input className="input" value={newFrom} onChange={e=>setNewFrom(e.target.value)}
              placeholder="root" style={{width:'100%',fontFamily:'var(--font-mono)'}}/>
          </div>
          <div style={{color:'var(--fg-dim)',paddingBottom:6}}>→</div>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:4}}>Przekieruj do</div>
            <input className="input" value={newTo} onChange={e=>setNewTo(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&addAlias()}
              placeholder="twoj@email.com" style={{width:'100%'}}/>
          </div>
          <button className="btn primary" onClick={addAlias} disabled={saving||!newFrom||!newTo}
            style={{flexShrink:0}}>
            {saving?'…':'Dodaj alias'}
          </button>
        </div>

        <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',padding:'6px var(--pad-card)',
          background:'color-mix(in oklch,var(--accent) 4%,transparent)'}}>
          💡 Dodaj alias <code>root → twój@email.com</code> aby otrzymywać powiadomienia crona i systemu
        </div>

        {aliases.length === 0 ? (
          <div style={{padding:24,textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
            Brak aliasów w /etc/aliases
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Alias</th><th>Przekierowanie</th></tr></thead>
            <tbody>
              {aliases.map(a => (
                <tr key={a.from}>
                  <td className="mono" style={{fontWeight:600}}>{a.from}</td>
                  <td className="mono">{a.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
