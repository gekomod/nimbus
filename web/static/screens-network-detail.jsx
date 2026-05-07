// ===== Sieć szczegółowo — ruch per-interfejs, per-kontener, firewall =====

const IFACE_COLORS = { eth0:'var(--accent)', eth1:'oklch(0.65 0.18 200)', wg0:'oklch(0.65 0.18 130)', 'br-dock':'oklch(0.65 0.15 75)' };

const MiniLine = ({ data, color='var(--accent)', h=28 }) => {
  if (!data||!data.length) return null;
  const w=120;
  const mn=Math.min(...data), mx=Math.max(...data)||1;
  const range=mx-mn||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v-mn)/range)*(h-4)-2}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:120,height:h}} preserveAspectRatio="none">
      <path d={`M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`} fill={color} opacity=".12"/>
      <path d={`M ${pts.join(' L ')}`} fill="none" stroke={color} strokeWidth="1.5"/>
    </svg>
  );
};

const BandwidthChart = ({ iface, series }) => {
  const w=800,h=180,pad=40;
  const {rx,tx}=series;
  if (!rx||rx.length<2) return (
    <div style={{height:180,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--fg-dim)',fontSize:'var(--fs-xs)'}}>
      Zbieranie danych…
    </div>
  );
  const all=[...rx,...tx];
  const mx=Math.max(...all,0.01);
  const n=rx.length;
  const x=i=>pad+(i/(n-1))*(w-pad*2);
  const y=v=>h-pad-(v/mx)*(h-pad*2);
  const rxPath="M "+rx.map((v,i)=>`${x(i)},${y(v)}`).join(" L ");
  const txPath="M "+tx.map((v,i)=>`${x(i)},${y(v)}`).join(" L ");
  const rxArea=`M ${x(0)},${h-pad} L ${rx.map((v,i)=>`${x(i)},${y(v)}`).join(" L ")} L ${x(n-1)},${h-pad} Z`;
  const txArea=`M ${x(0)},${h-pad} L ${tx.map((v,i)=>`${x(i)},${y(v)}`).join(" L ")} L ${x(n-1)},${h-pad} Z`;
  const gridYs=[0.25,0.5,0.75,1].map(p=>({v:(mx*p<0.1?(mx*p*1024).toFixed(0)+'K':(mx*p).toFixed(2)),y:h-pad-p*(h-pad*2)}));
  const color=IFACE_COLORS[iface]||'var(--accent)';
  const txColor='oklch(0.65 0.18 200)';
  // Etykiety osi X — tylko indeksy które istnieją
  const xLabels=[0,Math.floor(n*0.25),Math.floor(n*0.5),Math.floor(n*0.75),n-1].filter((v,i,a)=>a.indexOf(v)===i);
  const lastRxVal = rx[n-1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:180}} preserveAspectRatio="none">
      {gridYs.map(g=>(
        <g key={g.v}>
          <line x1={pad} x2={w-pad} y1={g.y} y2={g.y} stroke="var(--line)" strokeDasharray="3 5"/>
          <text x={pad-4} y={g.y+4} fontSize="10" fill="var(--fg-dim)" textAnchor="end" fontFamily="var(--font-mono)">{g.v}</text>
        </g>
      ))}
      <path d={rxArea} fill={color} opacity=".1"/>
      <path d={rxPath} fill="none" stroke={color} strokeWidth="2"/>
      <path d={txArea} fill={txColor} opacity=".1"/>
      <path d={txPath} fill="none" stroke={txColor} strokeWidth="1.5" strokeDasharray="4 3"/>
      {xLabels.map(i=>(
        <text key={i} x={x(i)} y={h-6} fontSize="10" fill="var(--fg-dim)" textAnchor="middle" fontFamily="var(--font-mono)">-{n-1-i}s</text>
      ))}
      <text x={w-pad+2} y={y(lastRxVal)+4} fontSize="11" fill={color} fontFamily="var(--font-mono)" fontWeight="600">
        {lastRxVal<0.1?(lastRxVal*1024).toFixed(0)+' KB/s':lastRxVal+' MB/s'}
      </text>
    </svg>
  );
};

const NetworkDetail = () => {
  const [tab,setTab] = React.useState('interfaces');
  const [selIface,setSelIface] = React.useState('');
  const [series,setSeries] = React.useState({});
  const [rules,setRules] = React.useState([]);
  const [containerNet, setContainerNet] = React.useState([]);
  const [addRuleOpen,setAddRuleOpen] = React.useState(false);
  const [newRule,setNewRule] = React.useState({chain:'INPUT',action:'ACCEPT',proto:'tcp',src:'',dport:'',comment:''});
  const [saving, setSaving] = React.useState(false);

  // Pobierz bandwidth z API co 3s
  React.useEffect(()=>{
    const load = async () => {
      try {
        const r = await fetch('/api/network/bandwidth', {credentials:'include'});
        if (!r.ok) return;
        const d = await r.json();
        const newSeries = {};
        (d.interfaces||[]).forEach(iface => {
          newSeries[iface.name] = {rx: iface.rx||[], tx: iface.tx||[]};
        });
        setSeries(newSeries);
        // Użyj setSelIface z funkcją — omija problem zamrożonego zamknięcia
        // Preferuj interfejs 'up' — czytaj window.NETWORK poza setState
        const NET2 = window.useStore ? window.useStore('NETWORK') : window.NETWORK;
        const netIfacesList = NET2?.interfaces || [];
        const names = Object.keys(newSeries);
        const upIface = names.find(n => netIfacesList.find(i => i.name === n && i.state === 'up'));
        const defaultIface = upIface || names.sort()[0] || '';
        setSelIface(prev => prev || defaultIface);
      } catch {}
    };
    load();
    const iv = setInterval(load, 3000);
    return () => clearInterval(iv);
  },[]);

  // Pobierz reguły firewall
  const loadRules = async () => {
    try {
      const r = await fetch('/api/network/firewall/rules', {credentials:'include'});
      if (r.ok) { const d = await r.json(); setRules(d.rules||[]); }
    } catch {}
  };
  React.useEffect(()=>{ if(tab==='firewall') loadRules(); },[tab]);

  // Pobierz ruch kontenerów
  React.useEffect(()=>{
    if(tab!=='percontainer') return;
    const load = async () => {
      try {
        const r = await fetch('/api/network/containers', {credentials:'include'});
        if (r.ok) { const d = await r.json(); setContainerNet(d.containers||[]); }
      } catch {}
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  },[tab]);

  const NETWORK = window.useStore ? window.useStore('NETWORK') : window.NETWORK;
  const allIfaces = NETWORK?.interfaces || [];
  // Odfiltruj interfejsy wirtualne (docker, veth, br-, virbr, lo)
  const VIRT_RE = /^(lo$|veth|br-|docker|virbr|tun|tap)/;
  const ifaces = allIfaces.filter(i => !VIRT_RE.test(i.name));
  // totalRx/Tx z series (bandwidth API) — iface.rx jest zawsze 0 w sys.go
  const totalRx = Object.values(series).reduce((sum, s) => {
    const v = s.rx.length ? s.rx[s.rx.length-1] : 0; return sum + v;
  }, 0);
  const totalTx = Object.values(series).reduce((sum, s) => {
    const v = s.tx.length ? s.tx[s.tx.length-1] : 0; return sum + v;
  }, 0);
  const blocked=rules.filter(r=>r.action==='DROP').reduce((s,r)=>s+r.hits,0);
  const selSeries=series[selIface]||{rx:[],tx:[]};
  // Ostatnia wartość — '—' gdy bufor jeszcze pusty (poller potrzebuje 2 próbek)
  const lastRx = selSeries.rx.length ? selSeries.rx[selSeries.rx.length-1] : null;
  const lastTx = selSeries.tx.length ? selSeries.tx[selSeries.tx.length-1] : null;
  const fmtBw = v => {
    if (v === null) return '—';
    if (v === 0) return '0 MB/s';
    if (v < 0.1) return (v * 1024).toFixed(0)+' KB/s';
    return v+' MB/s';
  };

  const chainColor={INPUT:'var(--accent)',OUTPUT:'var(--ok)',FORWARD:'oklch(0.65 0.15 75)'};
  const actionColor={ACCEPT:'var(--ok)',DROP:'var(--err)',REJECT:'var(--warn)'};

  return (
    <div className="col" style={{gap:'var(--gutter)'}}>
      <div className="grid grid-4">
        <div className="kpi">
          <div className="kpi-label">RX ŁĄCZNIE</div>
          <div className="kpi-value" style={{color:'var(--accent)'}}>{fmtBw(totalRx)}</div>
          <div className="kpi-foot"><span>MB/s przychodzący</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">TX ŁĄCZNIE</div>
          <div className="kpi-value" style={{color:'oklch(0.65 0.18 200)'}}>{fmtBw(totalTx)}</div>
          <div className="kpi-foot"><span>MB/s wychodzący</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">INTERFEJSY UP</div>
          <div className="kpi-value" style={{color:'var(--ok)'}}>{ifaces.filter(i=>i.state==='up').length}</div>
          <div className="kpi-foot"><span>z {ifaces.length} łącznie</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">ZABLOKOWANE</div>
          <div className="kpi-value" style={{color:'var(--warn)'}}>{blocked.toLocaleString()}</div>
          <div className="kpi-foot"><span>pakietów DROP/REJECT</span></div>
        </div>
      </div>

      <div className="segmented">
        {['interfaces','percontainer','firewall'].map(t=>(
          <button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>
            {{interfaces:'Interfejsy',percontainer:'Per kontener',firewall:'Firewall (nftables)'}[t]}
          </button>
        ))}
      </div>

      {tab==='interfaces' && (
        <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:'var(--gutter)'}}>
          {/* Iface list */}
          <div className="card" style={{alignSelf:'start'}}>
            <div className="card-head"><div className="card-title">Interfejsy</div></div>
            <div style={{padding:'4px 0'}}>
              {ifaces.map(iface=>{
                const s=series[iface.name];
                const rxNow=s&&s.rx.length ? s.rx[s.rx.length-1] : null;
                const txNow=s&&s.tx.length ? s.tx[s.tx.length-1] : null;
                const color=IFACE_COLORS[iface.name]||'var(--fg-dim)';
                return (
                  <div key={iface.name} onClick={()=>setSelIface(iface.name)}
                    style={{padding:'10px var(--pad-card)',cursor:'pointer',borderLeft:'3px solid',
                      borderLeftColor: selIface===iface.name?color:'transparent',
                      background: selIface===iface.name?'var(--accent-soft)':'transparent',
                      borderBottom:'1px solid var(--line)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{fontFamily:'var(--font-mono)',fontWeight:600,fontSize:'var(--fs-sm)',color:iface.state==='up'?'var(--fg)':'var(--fg-dim)'}}>{iface.name}</div>
                      <div style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>
                        <span style={{width:6,height:6,borderRadius:'50%',background:iface.state==='up'?'var(--ok)':'var(--fg-dim)',display:'inline-block'}}/>
                        <span style={{color:'var(--fg-dim)'}}>{iface.state}</span>
                      </div>
                    </div>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginTop:2,fontFamily:'var(--font-mono)'}}>{iface.ip}</div>
                    {iface.state==='up' && s && (
                      <div style={{display:'flex',gap:8,marginTop:6,fontSize:'var(--fs-xs)',fontFamily:'var(--font-mono)'}}>
                        <span style={{color}}><span style={{color:'var(--fg-dim)'}}>↓</span> {rxNow !== null ? rxNow+' MB/s' : '—'}</span>
                        <span style={{color:'oklch(0.65 0.18 200)'}}>↑ {txNow !== null ? txNow+' MB/s' : '—'}</span>
                      </div>
                    )}
                    {iface.state==='up' && s && <MiniLine data={s.rx} color={color}/>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail */}
          <div className="col" style={{gap:'var(--gutter)'}}>
            {(() => {
              const iface=ifaces.find(i=>i.name===selIface);
              if (!iface) return null;
              const color=IFACE_COLORS[selIface]||'var(--accent)';
              return (
                <>
                  <div className="card">
                    <div className="card-head">
                      <div>
                        <div className="card-title" style={{fontFamily:'var(--font-mono)'}}>{iface.name}</div>
                        <div className="card-sub">{iface.speed} · {iface.ip} · {iface.mac}</div>
                      </div>
                      <span className="badge" style={{background:iface.state==='up'?'var(--ok)':'var(--fg-dim)',color:'#fff',fontFamily:'var(--font-mono)'}}>{iface.state.toUpperCase()}</span>
                    </div>
                    <div className="card-body" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
                      {[
                        ['RX teraz', fmtBw(lastRx), color],
                        ['TX teraz', fmtBw(lastTx), 'oklch(0.65 0.18 200)'],
                        ['Speed', iface.speed, 'var(--fg)'],
                        ['VLAN', iface.vlan, 'var(--fg-dim)'],
                      ].map(([k,v,c])=>(
                        <div key={k}>
                          <div style={{fontSize:10,color:'var(--fg-dim)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:3}}>{k}</div>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:'var(--fs-sm)',fontWeight:600,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-head">
                      <div><div className="card-title">Przepustowość — {iface.name}</div><div className="card-sub">ostatnie 60 minut</div></div>
                      <div style={{display:'flex',gap:14,fontSize:'var(--fs-xs)'}}>
                        <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:20,height:2,background:color}}/><span style={{color:'var(--fg-dim)'}}>RX</span></div>
                        <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:20,height:2,background:'oklch(0.65 0.18 200)',opacity:.8}}/><span style={{color:'var(--fg-dim)'}}>TX</span></div>
                      </div>
                    </div>
                    <div style={{padding:'var(--pad-card)'}}>
                      <BandwidthChart iface={selIface} series={selSeries}/>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {tab==='percontainer' && (
        <div className="card">
          <div className="card-head">
            <div><div className="card-title">Ruch sieciowy kontenerów</div><div className="card-sub">docker stats · {containerNet.length} uruchomionych</div></div>
          </div>
          <table className="table">
            <thead><tr><th>Kontener</th><th>Tag</th><th>Porty</th><th style={{width:220}}>RX</th><th style={{width:220}}>TX</th><th>RX MB/s</th><th>TX MB/s</th></tr></thead>
            <tbody>
              {(containerNet.length ? containerNet : []).map(c=>{
                const total=c.rx+c.tx;
                const maxTotal=(containerNet[0]?.rx||0)+(containerNet[0]?.tx||0)||1;
                return (
                  <tr key={c.name}>
                    <td className="mono" style={{fontWeight:600}}>{c.name}</td>
                    <td><span className="chip">{c.tag}</span></td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{c.ports}</td>
                    <td>
                      <div style={{height:5,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:(c.rx/maxTotal*100)+'%',background:'var(--accent)',borderRadius:3}}/>
                      </div>
                    </td>
                    <td>
                      <div style={{height:5,background:'var(--bg-3)',borderRadius:3,overflow:'hidden'}}>
                        <div style={{height:'100%',width:(c.tx/maxTotal*100)+'%',background:'oklch(0.65 0.18 200)',borderRadius:3}}/>
                      </div>
                    </td>
                    <td className="mono" style={{color:'var(--accent)'}}>{c.rx}</td>
                    <td className="mono" style={{color:'oklch(0.65 0.18 200)'}}>{c.tx}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab==='firewall' && (
        <div className="col" style={{gap:'var(--gutter)'}}>
          <div className="grid grid-3">
            {['INPUT','OUTPUT','FORWARD'].map(chain=>{
              const chainRules=rules.filter(r=>r.chain===chain);
              const drops=chainRules.filter(r=>r.action==='DROP');
              return (
                <div key={chain} className="kpi">
                  <div className="kpi-label">{chain}</div>
                  <div className="kpi-value" style={{color:chainColor[chain]||'var(--fg)'}}>{chainRules.length}</div>
                  <div className="kpi-foot"><span>{drops.length} DROP · {chainRules.length-drops.length} ACCEPT</span></div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-head">
              <div><div className="card-title">Reguły firewall</div><div className="card-sub">nftables / iptables · {rules.length} reguł</div></div>
              <div className="card-actions">
                <button className="btn sm primary" onClick={()=>setAddRuleOpen(v=>!v)}><Icon name="plus" size={12}/> Nowa reguła</button>
              </div>
            </div>

            {addRuleOpen && (
              <div style={{padding:'12px var(--pad-card)',background:'var(--bg-2)',borderBottom:'1px solid var(--line)',
                display:'grid',gridTemplateColumns:'repeat(6,1fr) auto',gap:8,alignItems:'end'}}>
                {[
                  ['Chain',['INPUT','OUTPUT','FORWARD'],'chain'],
                  ['Akcja',['ACCEPT','DROP','REJECT'],'action'],
                  ['Proto',['tcp','udp','any'],'proto'],
                ].map(([label,opts,key])=>(
                  <div key={key}>
                    <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:3}}>{label}</div>
                    <select value={newRule[key]} onChange={e=>setNewRule(r=>({...r,[key]:e.target.value}))}
                      style={{background:'var(--bg)',border:'1px solid var(--line-strong)',borderRadius:5,
                        padding:'5px 8px',color:'var(--fg)',fontSize:'var(--fs-xs)',width:'100%',outline:'none'}}>
                      {opts.map(o=><option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {['Źródło','Port'].map((label,i)=>{
                  const key=i===0?'src':'dport';
                  return (
                    <div key={label}>
                      <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:3}}>{label}</div>
                      <input value={newRule[key]} onChange={e=>setNewRule(r=>({...r,[key]:e.target.value}))}
                        placeholder={i===0?'0.0.0.0/0':'80'}
                        style={{background:'var(--bg)',border:'1px solid var(--line-strong)',borderRadius:5,
                          padding:'5px 8px',color:'var(--fg)',fontFamily:'var(--font-mono)',fontSize:'var(--fs-xs)',width:'100%',outline:'none'}}/>
                    </div>
                  );
                })}
                <div>
                  <div style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',marginBottom:3}}>Komentarz</div>
                  <input value={newRule.comment} onChange={e=>setNewRule(r=>({...r,comment:e.target.value}))}
                    placeholder="Opis reguły"
                    style={{background:'var(--bg)',border:'1px solid var(--line-strong)',borderRadius:5,
                      padding:'5px 8px',color:'var(--fg)',fontSize:'var(--fs-xs)',width:'100%',outline:'none'}}/>
                </div>
                <button className="btn sm primary" onClick={()=>{
                  setSaving(true);
                  fetch('/api/network/firewall/rules', {
                    method:'POST', credentials:'include',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify(newRule),
                  }).then(()=>{ loadRules(); setAddRuleOpen(false); setSaving(false);
                    setNewRule({chain:'INPUT',action:'ACCEPT',proto:'tcp',src:'',dport:'',comment:''});
                  }).catch(()=>setSaving(false));
                }}><Icon name="check" size={11}/> Dodaj</button>
              </div>
            )}

            <table className="table">
              <thead>
                <tr><th style={{width:28}}/><th>Chain</th><th>Akcja</th><th>Proto</th><th>Źródło</th><th>Port</th><th>Komentarz</th><th>Trafień</th><th></th></tr>
              </thead>
              <tbody>
                {rules.map((r,idx)=>(
                  <tr key={r.id} style={{opacity:r.enabled?1:0.45}}>
                    <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-dim)',fontFamily:'var(--font-mono)'}}>{idx+1}</td>
                    <td><span className="badge" style={{background:(chainColor[r.chain]||'var(--fg)')+'22',color:chainColor[r.chain]||'var(--fg)'}}>{r.chain}</span></td>
                    <td><span className="badge" style={{background:(actionColor[r.action]||'var(--fg)')+'22',color:actionColor[r.action]||'var(--fg)'}}>{r.action}</span></td>
                    <td className="mono dim">{r.proto}</td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{r.src}</td>
                    <td className="mono" style={{fontSize:'var(--fs-xs)',color:'var(--accent)'}}>{r.dport||'any'}</td>
                    <td style={{fontSize:'var(--fs-xs)',color:'var(--fg-muted)'}}>{r.comment}</td>
                    <td className="mono dim" style={{fontSize:'var(--fs-xs)'}}>{r.hits.toLocaleString()}</td>
                    <td>
                      <div className="row gap-sm">
                        <div className={"toggle "+(r.enabled?'on':'')} onClick={()=>setRules(rs=>rs.map(x=>x.id===r.id?{...x,enabled:!x.enabled}:x))}/>
                        <button className="icon-btn" onClick={async()=>{
                          await fetch('/api/network/firewall/delete', {
                            method:'POST', credentials:'include',
                            headers:{'Content-Type':'application/json'},
                            body: JSON.stringify({chain:r.chain, rule_no:idx+1}),
                          });
                          loadRules();
                        }}><Icon name="trash" size={12}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

window.NetworkDetail = NetworkDetail;
