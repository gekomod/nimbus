// ===== Webmail — UI z szablonu podpięty pod /api/webmail/* =====

const FOLDERS = [
  { id:'INBOX',   label:'Odebrane',  icon:'M3 4h18l-2 14H5L3 4zm0 0l9 7 9-7' },
  { id:'Sent',    label:'Wysłane',   icon:'M4 12l16-8-6 18-3-7-7-3z' },
  { id:'Drafts',  label:'Szkice',    icon:'M4 4h12l4 4v12H4V4zm12 0v4h4M7 9h10M7 13h10M7 17h6' },
  { id:'Junk',    label:'Spam',      icon:'M12 2L2 22h20L12 2zm0 7v6m0 3v.5' },
  { id:'Trash',   label:'Kosz',      icon:'M4 7h16M9 7V4h6v3m-7 0v13h8V7M10 11v6m4-6v6' },
];

const FolderIcon = ({ d, size=15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d}/>
  </svg>
);

// ── Login ─────────────────────────────────────────────────────────────────────
const WebmailLogin = ({ onLogin }) => {
  const [email,   setEmail]   = React.useState('');
  const [pass,    setPass]    = React.useState('');
  const [err,     setErr]     = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  // Wstępnie wypełnij z konfiguracji Postfix jeśli możliwe
  React.useEffect(() => {
    fetch('/api/mail/postfix/config', { credentials:'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.config?.myorigin && !d.config.myorigin.startsWith('$')) {
          // Sugeruj adres na podstawie domeny
        }
      }).catch(() => {});
  }, []);

  const submit = async (e) => {
    e && e.preventDefault();
    setErr(null);
    if (!email.trim() || !pass) { setErr('Podaj adres e-mail i hasło'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/webmail/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: pass }),
      });
      const d = await r.json();
      if (d.ok) {
        onLogin({ email: email.trim(), name: d.name || email.split('@')[0], quota: d.quota });
      } else {
        setErr(d.error || 'Nieprawidłowy email lub hasło');
      }
    } catch(e) {
      setErr('Błąd połączenia z serwerem IMAP');
    } finally {
      setLoading(false);
    }
  };

  const inpSt = {
    background:'var(--bg-2)', border:'1px solid var(--line-strong)', borderRadius:7,
    padding:'10px 14px', color:'var(--fg)', fontSize:'var(--fs-base)',
    outline:'none', width:'100%', fontFamily:'inherit',
  };

  return (
    <div style={{display:'flex',justifyContent:'center',alignItems:'flex-start',paddingTop:40}}>
      <form onSubmit={submit} className="card" style={{width:420,padding:32}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
          <div style={{
            width:48,height:48,borderRadius:12,
            background:'linear-gradient(135deg, var(--accent), oklch(from var(--accent) calc(l - 0.18) c h))',
            display:'grid',placeItems:'center',color:'var(--accent-fg)',
            boxShadow:'0 4px 16px color-mix(in oklch, var(--accent) 35%, transparent)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="5" width="18" height="14" rx="2"/>
              <path d="M3 7l9 6 9-6"/>
            </svg>
          </div>
          <div>
            <div style={{fontWeight:700,fontSize:18}}>Nimbus Mail</div>
            <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>Webmail · Dovecot IMAP</div>
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6,letterSpacing:'.04em'}}>ADRES E-MAIL</div>
          <input style={inpSt} value={email} onChange={e=>setEmail(e.target.value)} autoFocus placeholder="user@example.com" type="email"/>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:6,letterSpacing:'.04em'}}>HASŁO</div>
          <input style={inpSt} type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="hasło do konta IMAP"/>
        </div>

        {err && (
          <div style={{padding:'8px 12px',borderRadius:6,background:'oklch(0.66 0.2 25/0.1)',
            border:'1px solid oklch(0.66 0.2 25/0.3)',color:'var(--err)',fontSize:'var(--fs-xs)',marginBottom:14}}>
            {err}
          </div>
        )}

        <button type="submit" className="btn primary" disabled={loading} style={{width:'100%',padding:'11px',fontSize:'var(--fs-base)',justifyContent:'center'}}>
          {loading ? <><span className="dot pulse" style={{marginRight:6}}/>Logowanie…</> : 'Zaloguj się'}
        </button>

        <div style={{marginTop:18,padding:'10px 12px',background:'var(--bg-2)',borderRadius:6,fontSize:'var(--fs-xs)',color:'var(--fg-dim)',lineHeight:1.6}}>
          Zaloguj się kontem skonfigurowanym w zakładce <b>Serwer poczty → Konta</b>
        </div>
      </form>
    </div>
  );
};

// ── Compose ───────────────────────────────────────────────────────────────────
const ComposeDialog = ({ me, prefill, onClose, onSent }) => {
  const [to,      setTo]      = React.useState(prefill?.to || '');
  const [subj,    setSubj]    = React.useState(prefill?.subject || '');
  const [body,    setBody]    = React.useState(prefill?.body || '\n\n');
  const [sending, setSending] = React.useState(false);
  const [err,     setErr]     = React.useState('');

  const send = async () => {
    if (!to.trim() || !subj.trim()) { setErr('Podaj odbiorcę i temat'); return; }
    setSending(true); setErr('');
    try {
      const r = await fetch('/api/webmail/send', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ to: to.trim(), subject: subj.trim(), body, email: me.email, password: me.password }),
      });
      const d = await r.json();
      if (d.ok) {
        onSent && onSent({ to: to.trim(), subject: subj.trim(), body });
        onClose();
      } else {
        setErr(d.error || 'Błąd wysyłania');
        setSending(false);
      }
    } catch(e) {
      setErr('Błąd połączenia');
      setSending(false);
    }
  };

  const inpSt = { background:'transparent', border:'none', outline:'none', width:'100%', color:'var(--fg)', fontSize:'var(--fs-sm)', padding:'10px 0' };
  const rowSt = { display:'grid', gridTemplateColumns:'70px 1fr', alignItems:'center', gap:8, padding:'0 16px', borderBottom:'1px solid var(--line)' };
  const lblSt = { fontSize:'var(--fs-xs)', color:'var(--fg-dim)', letterSpacing:'.04em', textTransform:'uppercase' };

  return (
    <div style={{
      position:'absolute', right:20, bottom:20, width:580,
      background:'var(--bg-1)', borderRadius:12,
      border:'1px solid var(--line-strong)',
      boxShadow:'0 24px 56px rgba(0,0,0,0.55)',
      zIndex:200, display:'flex', flexDirection:'column',
    }}>
      <div style={{padding:'12px 16px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:10}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M3 8l9 6 9-6M3 8v12h18V8M3 8l9-6 9 6"/></svg>
        <div style={{fontWeight:600,flex:1}}>{subj || 'Nowa wiadomość'}</div>
        <button className="icon-btn" onClick={onClose}><Icon name="close" size={13}/></button>
      </div>
      <div style={rowSt}><span style={lblSt}>Od</span><span className="mono" style={{fontSize:'var(--fs-sm)'}}>{me.email}</span></div>
      <div style={rowSt}><span style={lblSt}>Do</span><input style={inpSt} value={to} onChange={e=>setTo(e.target.value)} placeholder="adres@example.com"/></div>
      <div style={rowSt}><span style={lblSt}>Temat</span><input style={inpSt} value={subj} onChange={e=>setSubj(e.target.value)} placeholder="Temat wiadomości"/></div>
      <textarea
        value={body} onChange={e=>setBody(e.target.value)}
        style={{flex:1,minHeight:240,background:'transparent',border:'none',outline:'none',padding:'14px 16px',color:'var(--fg)',fontSize:'var(--fs-sm)',lineHeight:1.6,resize:'none',fontFamily:'inherit'}}
      />
      {err && <div style={{padding:'6px 16px',color:'var(--err)',fontSize:'var(--fs-xs)'}}>{err}</div>}
      <div style={{padding:'10px 16px',borderTop:'1px solid var(--line)',display:'flex',gap:8,alignItems:'center'}}>
        <button className="btn primary" disabled={sending || !to.trim() || !subj.trim()} onClick={send}>
          {sending
            ? <><span className="dot pulse"/>Wysyłanie…</>
            : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 12l16-8-6 18-3-7-7-3z"/></svg> Wyślij</>
          }
        </button>
        <div style={{flex:1}}/>
        <span style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{body.length} znaków</span>
      </div>
    </div>
  );
};

// ── Główny widok ──────────────────────────────────────────────────────────────
const Webmail = () => {
  const [user,     setUser]     = React.useState(null); // { email, name, password, quota }
  const [folder,   setFolder]   = React.useState('INBOX');
  const [messages, setMessages] = React.useState([]);
  const [selected, setSelected] = React.useState(null);
  const [msgBody,  setMsgBody]  = React.useState(null);
  const [composing,setComposing]= React.useState(null);
  const [search,   setSearch]   = React.useState('');
  const [loading,  setLoading]  = React.useState(false);
  const [syncing,  setSyncing]  = React.useState(false);
  const [counts,   setCounts]   = React.useState({});

  // Załaduj wiadomości gdy zmieni się folder
  const loadFolder = async (fld, usr) => {
    const u = usr || user;
    if (!u) return;
    setLoading(true); setSelected(null); setMsgBody(null);
    try {
      const r = await fetch(`/api/webmail/messages?folder=${encodeURIComponent(fld)}`, {
        credentials:'include',
        headers:{ 'X-Webmail-Email': u.email, 'X-Webmail-Password': u.password },
      });
      if (!r.ok) return;
      const d = await r.json();
      setMessages(d.messages || []);
    } catch(e) {} finally { setLoading(false); }
  };

  // Załaduj liczbę nieprzeczytanych dla folderów
  const loadCounts = async (u) => {
    try {
      const r = await fetch('/api/webmail/counts', {
        credentials:'include',
        headers:{ 'X-Webmail-Email': u.email, 'X-Webmail-Password': u.password },
      });
      if (!r.ok) return;
      const d = await r.json();
      setCounts(d.counts || {});
    } catch(e) {}
  };

  const handleLogin = async (u) => {
    // Zapisz hasło w session storage (tylko na czas sesji przeglądarki)
    const password = document.querySelector('input[type=password]')?.value || '';
    const usr = { ...u, password };
    setUser(usr);
    await loadFolder('INBOX', usr);
    await loadCounts(usr);
  };

  const handleFolderChange = (fld) => {
    setFolder(fld);
    loadFolder(fld);
  };

  // Odczytaj wiadomość
  const openMessage = async (msg) => {
    setSelected(msg.uid);
    if (msg.body) { setMsgBody(msg.body); return; }
    try {
      const r = await fetch(`/api/webmail/message?folder=${encodeURIComponent(folder)}&uid=${msg.uid}`, {
        credentials:'include',
        headers:{ 'X-Webmail-Email': user.email, 'X-Webmail-Password': user.password },
      });
      const d = await r.json();
      setMsgBody(d.body || '(brak treści)');
      // Oznacz jako przeczytane w UI
      setMessages(ms => ms.map(m => m.uid === msg.uid ? {...m, read: true} : m));
    } catch(e) { setMsgBody('Błąd pobierania wiadomości'); }
  };

  const refresh = async () => {
    setSyncing(true);
    await loadFolder(folder);
    await loadCounts(user);
    setSyncing(false);
  };

  const deleteMsg = async (uid) => {
    try {
      await fetch('/api/webmail/delete', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json','X-Webmail-Email':user.email,'X-Webmail-Password':user.password},
        body: JSON.stringify({ folder, uid }),
      });
      setMessages(ms => ms.filter(m => m.uid !== uid));
      if (selected === uid) { setSelected(null); setMsgBody(null); }
    } catch(e) {}
  };

  const moveMsg = async (uid, dest) => {
    try {
      await fetch('/api/webmail/move', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json','X-Webmail-Email':user.email,'X-Webmail-Password':user.password},
        body: JSON.stringify({ folder, uid, dest }),
      });
      setMessages(ms => ms.filter(m => m.uid !== uid));
      if (selected === uid) { setSelected(null); setMsgBody(null); }
    } catch(e) {}
  };

  if (!user) return <WebmailLogin onLogin={handleLogin}/>;

  const visible = messages.filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (m.subject + ' ' + m.from + ' ' + m.from_name).toLowerCase().includes(q);
  });

  const selectedMsg = messages.find(m => m.uid === selected);

  return (
    <div style={{position:'relative'}}>
      <div style={{
        display:'grid',
        gridTemplateColumns:'200px 360px 1fr',
        gap:'var(--gutter)',
        height:'calc(100vh - 180px)',
        minHeight:520,
      }}>
        {/* Foldery */}
        <div className="card" style={{display:'flex',flexDirection:'column',padding:0,overflow:'hidden'}}>
          <div style={{padding:'14px',borderBottom:'1px solid var(--line)'}}>
            <button className="btn primary" style={{width:'100%',justifyContent:'center',padding:'10px'}} onClick={()=>setComposing({})}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14"/></svg>
              Nowa wiadomość
            </button>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'8px 6px'}}>
            {FOLDERS.map(f => {
              const unread = counts[f.id] || 0;
              const active = folder === f.id;
              return (
                <div key={f.id}
                  onClick={() => handleFolderChange(f.id)}
                  style={{
                    display:'flex',alignItems:'center',gap:10,
                    padding:'8px 10px',borderRadius:6,cursor:'pointer',
                    background: active ? 'var(--bg-2)' : 'transparent',
                    color: active ? 'var(--fg)' : 'var(--fg-muted)',
                    position:'relative',
                  }}
                >
                  {active && <div style={{position:'absolute',left:-6,top:6,bottom:6,width:2,background:'var(--accent)',borderRadius:'0 2px 2px 0'}}/>}
                  <span style={{color: active?'var(--accent)':'var(--fg-dim)'}}><FolderIcon d={f.icon}/></span>
                  <span style={{flex:1,fontSize:'var(--fs-sm)',fontWeight:active?500:400}}>{f.label}</span>
                  {unread > 0 && (
                    <span style={{
                      fontFamily:'var(--font-mono)',fontSize:10,fontWeight:600,
                      padding:'1px 7px',borderRadius:10,
                      background: f.id==='Junk'?'color-mix(in oklch,var(--err) 25%,transparent)':'color-mix(in oklch,var(--accent) 25%,transparent)',
                      color: f.id==='Junk'?'var(--err)':'var(--accent)',
                    }}>{unread}</span>
                  )}
                </div>
              );
            })}
            <hr className="div" style={{margin:'10px 4px'}}/>
            {user.quota && (
              <div style={{padding:'0 10px 10px'}}>
                <div style={{fontSize:9,color:'var(--fg-dim)',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:6}}>QUOTA</div>
                <div style={{height:5,background:'var(--bg-3)',borderRadius:3,overflow:'hidden',marginBottom:5}}>
                  <div style={{height:'100%',width:Math.min(100,(user.quota.used/user.quota.max*100))+'%',background:'var(--ok)',borderRadius:3}}/>
                </div>
                <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>
                  {Math.round(user.quota.used/1024/1024)} / {Math.round(user.quota.max/1024/1024)} MB
                </div>
              </div>
            )}
          </div>
          <div style={{padding:'10px 14px',borderTop:'1px solid var(--line)',display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:28,height:28,borderRadius:'50%',background:'var(--accent)',color:'var(--accent-fg)',display:'grid',placeItems:'center',fontSize:11,fontWeight:700}}>
              {user.email[0].toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:'var(--fs-xs)',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user.email}</div>
              <div style={{fontSize:9,color:'var(--ok)'}}><span className="dot" style={{display:'inline-block',marginRight:4}}/>IMAP połączony</div>
            </div>
            <button className="icon-btn" onClick={()=>{ setUser(null); setMessages([]); }} title="Wyloguj">
              <Icon name="close" size={12}/>
            </button>
          </div>
        </div>

        {/* Lista wiadomości */}
        <div className="card" style={{display:'flex',flexDirection:'column',padding:0,overflow:'hidden'}}>
          <div style={{padding:'10px 12px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',gap:8}}>
            <Icon name="search" size={13} style={{color:'var(--fg-dim)'}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Szukaj w folderze…"
              style={{flex:1,background:'transparent',border:'none',outline:'none',color:'var(--fg)',fontSize:'var(--fs-sm)'}}/>
            <button className="icon-btn" onClick={refresh} title="Odśwież">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{animation:syncing?'spin 0.9s linear infinite':'none',transformOrigin:'center'}}>
                <path d="M3 12a9 9 0 019-9 9 9 0 016.4 2.6L21 8M21 3v5h-5"/>
                <path d="M21 12a9 9 0 01-9 9 9 9 0 01-6.4-2.6L3 16M3 21v-5h5"/>
              </svg>
            </button>
            <style>{`@keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }`}</style>
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {loading ? (
              <div style={{padding:40,textAlign:'center',color:'var(--fg-dim)'}}>
                <div style={{width:18,height:18,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .6s linear infinite',margin:'0 auto 12px'}}/>
                Ładowanie…
              </div>
            ) : visible.length === 0 ? (
              <div style={{padding:'60px 20px',textAlign:'center',color:'var(--fg-dim)',fontSize:'var(--fs-sm)'}}>
                <div style={{fontSize:36,opacity:0.3,marginBottom:8}}>✉</div>
                {search ? 'Brak wyników' : 'Folder jest pusty'}
              </div>
            ) : visible.map(m => {
              const active = selected === m.uid;
              return (
                <div key={m.uid}
                  onClick={() => openMessage(m)}
                  style={{
                    padding:'10px 14px',
                    borderBottom:'1px solid var(--line)',
                    background: active ? 'color-mix(in oklch, var(--accent) 10%, var(--bg-1))'
                              : !m.read ? 'var(--bg-1)' : 'transparent',
                    cursor:'pointer',
                    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                    {!m.read && <span style={{width:7,height:7,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>}
                    <span style={{fontWeight:m.read?500:700,fontSize:'var(--fs-sm)',flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {folder==='Sent'||folder==='Drafts' ? `do: ${m.to}` : (m.from_name || m.from)}
                    </span>
                    <span style={{fontSize:10,color:'var(--fg-dim)',fontFamily:'var(--font-mono)',flexShrink:0}}>
                      {m.date ? m.date.slice(11,16) || m.date.slice(5,10) : ''}
                    </span>
                  </div>
                  <div style={{fontSize:'var(--fs-sm)',color:m.read?'var(--fg-muted)':'var(--fg)',fontWeight:m.read?400:600,marginBottom:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {m.subject || '(bez tematu)'}
                  </div>
                  <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                    {m.preview || ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel czytania */}
        <div className="card" style={{display:'flex',flexDirection:'column',padding:0,overflow:'hidden'}}>
          {selectedMsg ? (
            <>
              <div style={{padding:'16px 20px',borderBottom:'1px solid var(--line)'}}>
                <div style={{display:'flex',alignItems:'flex-start',gap:14}}>
                  <div style={{
                    width:42,height:42,borderRadius:'50%',flexShrink:0,
                    background:`hsl(${((selectedMsg.from||'').charCodeAt(0)*37)%360} 55% 45%)`,
                    color:'white',display:'grid',placeItems:'center',fontSize:16,fontWeight:700,
                  }}>{((selectedMsg.from_name||selectedMsg.from||'?')[0]).toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:17,fontWeight:600,marginBottom:5}}>{selectedMsg.subject || '(bez tematu)'}</div>
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:'var(--fs-sm)',marginBottom:2}}>
                      <span style={{fontWeight:500}}>{selectedMsg.from_name || selectedMsg.from}</span>
                      {selectedMsg.from_name && <span className="mono dim" style={{fontSize:'var(--fs-xs)'}}>&lt;{selectedMsg.from}&gt;</span>}
                    </div>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>
                      do: <span className="mono">{selectedMsg.to || user.email}</span> · <span className="mono">{selectedMsg.date}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{padding:'10px 20px',borderBottom:'1px solid var(--line)',display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn sm primary" onClick={()=>setComposing({
                  to: selectedMsg.from,
                  subject: 'Re: '+((selectedMsg.subject||'').replace(/^Re:\s*/,'')),
                  body: `\n\n—— W dniu ${selectedMsg.date} ${selectedMsg.from_name||selectedMsg.from} napisał(a) ——\n${(msgBody||'').split('\n').map(l=>'> '+l).join('\n')}`,
                })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 17l-5-5 5-5M4 12h11a5 5 0 015 5v3"/></svg> Odpowiedz
                </button>
                <button className="btn sm" onClick={()=>setComposing({
                  subject: 'Fwd: '+((selectedMsg.subject||'').replace(/^Fwd:\s*/,'')),
                  body: `\n\n—— Wiadomość przekazana ——\nOd: ${selectedMsg.from_name||selectedMsg.from} <${selectedMsg.from}>\nData: ${selectedMsg.date}\nTemat: ${selectedMsg.subject}\n\n${msgBody||''}`,
                })}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 17l5-5-5-5M20 12H9a5 5 0 00-5 5v3"/></svg> Przekaż
                </button>
                <button className="btn sm" onClick={()=>moveMsg(selectedMsg.uid, folder==='Junk'?'INBOX':'Junk')}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 22h20L12 2zm0 7v6m0 3v.5"/></svg>
                  {folder==='Junk'?'Nie spam':'Spam'}
                </button>
                <div style={{flex:1}}/>
                <button className="btn sm" onClick={()=>deleteMsg(selectedMsg.uid)}>
                  <Icon name="trash" size={11}/> {folder==='Trash'?'Usuń trwale':'Usuń'}
                </button>
              </div>
              <div style={{flex:1,overflowY:'auto',padding:'20px 22px',fontSize:'var(--fs-base)',lineHeight:1.7,whiteSpace:'pre-wrap',color:'var(--fg)',fontFamily:'inherit'}}>
                {msgBody === null
                  ? <div style={{color:'var(--fg-dim)',textAlign:'center',paddingTop:40}}>
                      <div style={{width:16,height:16,border:'2px solid var(--line-strong)',borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .6s linear infinite',margin:'0 auto 8px'}}/>
                      Ładowanie treści…
                    </div>
                  : msgBody
                }
              </div>
            </>
          ) : (
            <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'var(--fg-dim)',gap:14}}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{opacity:0.4}}>
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="M3 7l9 6 9-6"/>
              </svg>
              <div style={{fontSize:'var(--fs-sm)'}}>Wybierz wiadomość aby ją odczytać</div>
              <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)'}}>{visible.length} wiadomości w folderze</div>
            </div>
          )}
        </div>
      </div>

      {composing && (
        <ComposeDialog
          me={user}
          prefill={composing}
          onClose={() => setComposing(null)}
          onSent={msg => {
            setMessages(ms => [{ uid: Date.now(), folder:'Sent', from:user.email, to:msg.to, subject:msg.subject, date:new Date().toISOString().slice(0,16).replace('T',' '), read:true, preview:msg.body.slice(0,80) }, ...ms]);
          }}
        />
      )}
    </div>
  );
};

window.Webmail = Webmail;
