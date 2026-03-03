import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

export default function App() {
  const [contestants, setContestants] = useState([]);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('is_survivor_admin') === 'true');
  const [scores, setScores] = useState([]);
  const [currentWeek, setCurrentWeek] = useState(2);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);

  const fetchData = useCallback(async () => {
    const { data: c } = await supabase.from('contestants').select('*').order('name');
    const { data: s } = await supabase.from('profiles').select('*').order('points', { ascending: false });
    const { data: g = {} } = await supabase.from('game_settings').select('*').single();

    if (c) setContestants(c);
    if (s) setScores(s);
    if (g) setCurrentWeek(g.current_week || 2);

    const savedEmail = localStorage.getItem('survivor_email');
    if (savedEmail && g.current_week) {
      const { data: v } = await supabase.from('votes')
        .select('*')
        .eq('email', savedEmail)
        .eq('week_number', g.current_week)
        .maybeSingle();
      
      setHasVoted(!!v);
      if (v && c) setSelectedCandidate(c.find(p => p.id === v.contestant_id));
    }
  }, []);

  useEffect(() => {
    fetchData();
    const sub = supabase.channel('master-room')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData())
      .subscribe();
    return () => supabase.removeChannel(sub);
  }, [fetchData]);

  const handleAdminToggle = () => {
    if (isAdmin) { 
      setIsAdmin(false); 
      sessionStorage.removeItem('is_survivor_admin'); 
    } else {
      const code = window.prompt("Admin Code:");
      if (code === "SURVIVOR50") {
        setIsAdmin(true);
        sessionStorage.setItem('is_survivor_admin', 'true');
      }
    }
  };

  const handleEliminate = async (id) => {
    if (!window.confirm("Snuff torch? Points will be calculated.")) return;
    await supabase.from('contestants').update({ is_eliminated: true, is_at_risk: false }).eq('id', id);
    const { data: weekVotes } = await supabase.from('votes').select('*').eq('week_number', currentWeek);
    
    if (weekVotes) {
      for (const v of weekVotes) {
        const pts = (v.contestant_id === id) ? 10 : -2;
        const { data: p } = await supabase.from('profiles').select('points').eq('email', v.email).maybeSingle();
        const currentTotal = p?.points || 0;

        await supabase.from('profiles').upsert({ 
          email: v.email,
          username: v.username, 
          points: currentTotal + pts 
        }, { onConflict: 'email' });
      }
    }
    fetchData();
  };

  const tribes = contestants.filter(c => !c.is_eliminated).reduce((acc, c) => {
    const t = c.tribe_name || 'Merge';
    if (!acc[t]) acc[t] = [];
    acc[t].push(c);
    return acc;
  }, {});

  const graveyard = contestants.filter(c => c.is_eliminated);

  return (
    <div style={{ backgroundColor: '#020617', color: 'white', minHeight: '100vh', width: '100%', boxSizing: 'border-box', overflowX: 'hidden', paddingBottom: '180px' }}>
      
      {/* HEADER */}
      <div style={{ padding: '20px 15px', maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ color: '#f97316', fontSize: '1.6rem', margin: 0, fontWeight: '900' }}>EPISODE {currentWeek}</h1>
        </div>
        <button onClick={handleAdminToggle} style={{ background: '#1e293b', border: 'none', padding: '10px', borderRadius: '10px', fontSize: '1.2rem', cursor: 'pointer' }}>
          {isAdmin ? '🔒' : '🛠️'}
        </button>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 15px' }}>
        
        {/* LEADERBOARD */}
        <div style={{ background: '#0f172a', padding: '15px', borderRadius: '20px', border: '1px solid #1e293b', marginBottom: '30px' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b', textAlign: 'center', marginBottom: '10px', letterSpacing: '2px', fontWeight: 'bold' }}>CURRENT STANDINGS</div>
          {scores.length > 0 ? (
              scores.slice(0, 5).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', padding: '8px 0', borderBottom: '1px solid #1e293b' }}>
                  <span>{s.username}</span>
                  <span style={{ color: s.points >= 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                    {s.points}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#475569', padding: '10px 0' }}>No active players. Scoreboard cleared.</div>
            )
          }
        </div>

        {/* ADMIN PANEL */}
        {isAdmin && (
          <div style={{ border: '2px solid #ef4444', padding: '15px', borderRadius: '20px', marginBottom: '30px', background: 'rgba(239, 68, 68, 0.1)' }}>
            <button 
              onClick={async () => { 
                if (!window.confirm("RESET ENTIRE GAME? This deletes all players and scores.")) return;
                
                try {
                  setScores([]); 
                  setSelectedCandidate(null); 
                  setHasVoted(false); 
                  
                  const { error } = await supabase.rpc('season_hard_reset'); 
                  if (error) throw error;

                  await new Promise(res => setTimeout(res, 500));
                  await fetchData(); 
                  alert("Game Reset: Scoreboard cleared and contestants restored."); 
                } catch (err) {
                  alert("Reset Error: " + err.message);
                  fetchData(); 
                }
              }} 
              style={{ width: '100%', padding: '14px', background: '#ef4444', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '12px', marginBottom: '10px' }}
            >
              HARD RESET TO EPISODE 2
            </button>
            <button 
              onClick={async () => { 
                await supabase.from('game_settings').update({current_week: currentWeek + 1}).neq('id', 0);
                await supabase.from('contestants').update({is_at_risk: false}).neq('id', 0);
                fetchData();
              }} 
              style={{ width: '100%', padding: '14px', background: '#22c55e', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '12px' }}
            >
              START NEXT EPISODE
            </button>
          </div>
        )}

        {/* TRIBE SECTIONS */}
        {Object.entries(tribes).map(([name, members]) => (
          <div key={name} style={{ marginBottom: '40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h2 style={{ fontSize: '1.1rem', color: members[0].tribe_color || '#f97316', margin: 0, letterSpacing: '1px' }}>{name.toUpperCase()}</h2>
                {isAdmin && (
                    <button 
                        onClick={async () => {
                            const allAtRisk = members.every(m => m.is_at_risk);
                            await supabase.from('contestants').update({is_at_risk: !allAtRisk}).eq('tribe_name', name).eq('is_eliminated', false);
                            fetchData();
                        }}
                        style={{ background: '#334155', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '6px', fontSize: '0.7rem' }}
                    >
                        TOGGLE TRIBE
                    </button>
                )}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '15px' }}>
              {members.map(c => (
                <div key={c.id} style={{ position: 'relative' }}>
                  {isAdmin && (
                    <div style={{ position: 'absolute', top: '-8px', left: '0', right: '0', display: 'flex', justifyContent: 'space-between', zIndex: 10, padding: '0 5px' }}>
                      <button onClick={() => handleEliminate(c.id)} style={{ background: '#ef4444', border: '2px solid #020617', borderRadius: '50%', width: '32px', height: '32px', color: 'white', fontWeight: 'bold' }}>✕</button>
                      <button onClick={async () => { await supabase.from('contestants').update({is_at_risk: !c.is_at_risk}).eq('id', c.id); fetchData(); }} style={{ background: '#eab308', border: '2px solid #020617', borderRadius: '50%', width: '32px', height: '32px', fontWeight: 'bold' }}>🔥</button>
                    </div>
                  )}
                  <button 
                    onClick={() => (c.is_at_risk || isAdmin) && setSelectedCandidate(c)}
                    style={{ 
                      width: '100%', padding: 0, borderRadius: '20px', overflow: 'hidden', background: '#0f172a', 
                      border: selectedCandidate?.id === c.id ? '4px solid #f97316' : '1px solid #1e293b',
                      filter: (c.is_at_risk || isAdmin) ? 'brightness(1.1)' : 'brightness(0.6) grayscale(0.2)',
                      transition: 'all 0.2s ease',
                      cursor: (c.is_at_risk || isAdmin) ? 'pointer' : 'default'
                    }}
                  >
                    <div style={{ width: '100%', height: '180px', overflow: 'hidden' }}>
                        <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
                    </div>
                    <div style={{ padding: '12px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: '900', color: 'white' }}>{c.name.toUpperCase()}</div>
                      <div style={{ fontSize: '0.65rem', color: c.is_at_risk ? '#f97316' : '#475569', fontWeight: 'bold', marginTop: '4px' }}>
                        {c.is_at_risk ? '🔥 AT RISK' : '🛡️ SAFE'}
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* GRAVEYARD */}
        <div style={{ marginTop: '50px', padding: '25px', backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '24px', border: '1px dashed #334155' }}>
          <h3 style={{ fontSize: '0.75rem', textAlign: 'center', color: '#475569', marginBottom: '20px', letterSpacing: '4px' }}>THE GRAVEYARD</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px' }}>
            {graveyard.map(g => (
              <div key={g.id} style={{ textAlign: 'center', width: '70px' }}>
                <div style={{ width: '60px', height: '60px', borderRadius: '50%', overflow: 'hidden', margin: '0 auto 8px', filter: 'grayscale(1) opacity(0.6)', border: '2px solid #1e293b' }}>
                  <img src={g.image_url} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
                </div>
                <div style={{ fontSize: '0.6rem', color: '#475569' }}>{g.name.split(' ')[0]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* VOTING FOOTER */}
      {/* ... Voting logic remains identical ... */}
      {!isAdmin && selectedCandidate && selectedCandidate.is_at_risk && !hasVoted && (
        <div style={{ position: 'fixed', bottom: '0', left: '0', right: '0', padding: '25px', background: 'linear-gradient(to top, #020617 70%, transparent)', display: 'flex', justifyContent: 'center', zIndex: 100 }}>
          <button 
            onClick={async () => {
              let email = localStorage.getItem('survivor_email');
              let username = localStorage.getItem('survivor_username');

              if (!email) {
                const inputEmail = window.prompt("Enter your email to save score ( integrity ) :");
                if (!inputEmail || !inputEmail.includes('@')) return alert("Valid email required!");
                email = inputEmail.toLowerCase().trim();
                
                const inputName = window.prompt("Enter your Scoreboard Name:");
                username = inputName ? inputName.trim() : email.split('@')[0];

                localStorage.setItem('survivor_email', email);
                localStorage.setItem('survivor_username', username);
              }

              const { error } = await supabase.from('votes').upsert({ 
                email, 
                username, 
                contestant_id: selectedCandidate.id, 
                week_number: currentWeek 
              }, { onConflict: 'email, week_number' });

              if (error) alert("Vote failed or already cast!");
              fetchData();
            }} 
            style={{ width: '100%', maxWidth: '400px', padding: '20px', background: '#f97316', color: 'white', borderRadius: '50px', fontWeight: '900', border: 'none', boxShadow: '0 8px 25px rgba(249, 115, 22, 0.4)', fontSize: '1.1rem' }}
          >
            VOTE FOR {selectedCandidate.name.toUpperCase()}
          </button>
        </div>
      )}

      {hasVoted && !isAdmin && (
        <div style={{ position: 'fixed', bottom: '30px', left: '0', right: '0', textAlign: 'center', zIndex: 100 }}>
          <span style={{ background: '#22c55e', color: 'white', padding: '15px 35px', borderRadius: '50px', fontWeight: '900', boxShadow: '0 5px 15px rgba(0,0,0,0.3)' }}>
            ✅ VOTE CAST: {selectedCandidate?.name.toUpperCase()}
          </span>
        </div>
      )}
    </div>
  );
}