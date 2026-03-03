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

    const savedName = localStorage.getItem('survivor_username');
    if (savedName && g.current_week) {
      const { data: v } = await supabase.from('votes')
        .select('*')
        .eq('username', savedName)
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
        const { data: p } = await supabase.from('profiles').select('points').eq('username', v.username).single();
        await supabase.from('profiles').upsert({ 
          username: v.username, 
          points: (p?.points || 0) + pts 
        }, { onConflict: 'username' });
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
    <div style={{ padding: '20px', backgroundColor: '#020617', color: 'white', minHeight: '100vh', fontFamily: 'sans-serif', paddingBottom: '180px' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ color: '#f97316', fontSize: '1.4rem', margin: 0, fontWeight: '900' }}>EPISODE {currentWeek}</h1>
        <button onClick={handleAdminToggle} style={{ opacity: 0.3, background: 'none', border: 'none', color: 'white', fontSize: '1.2rem' }}>{isAdmin ? '🔒' : '🛠'}</button>
      </div>

      {/* LEADERBOARD */}
      <div style={{ background: '#0f172a', padding: '15px', borderRadius: '15px', border: '1px solid #1e293b', marginBottom: '30px' }}>
        <div style={{ fontSize: '0.65rem', color: '#64748b', textAlign: 'center', marginBottom: '10px', letterSpacing: '2px', fontWeight: 'bold' }}>CURRENT STANDINGS</div>
        {scores.filter(s => s.points > 0).length > 0 ? (
            scores.filter(s => s.points > 0).slice(0, 5).map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', padding: '5px 0', borderBottom: '1px solid #1e293b' }}>
                <span>{s.username}</span>
                <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{s.points}</span>
              </div>
            ))
          ) : (
            <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#475569', padding: '10px 0' }}>No points awarded yet this season.</div>
          )
        }
      </div>

      {/* ADMIN PANEL */}
      {isAdmin && (
        <div style={{ border: '2px solid #ef4444', padding: '15px', borderRadius: '15px', marginBottom: '30px', background: 'rgba(239, 68, 68, 0.1)' }}>
          <button 
            onClick={async () => { 
              if (!window.confirm("RESET ENTIRE GAME? This clears all points, resets to Ep 2, and empties scoreboard.")) return;
              const { error } = await supabase.rpc('season_hard_reset'); 
              if (error) {
                alert("Reset Error: " + error.message);
              } else {
                // FIXED: Clear ALL local state so the UI "forgets" previous testing
                setSelectedCandidate(null); 
                setHasVoted(false);
                await fetchData(); 
                alert("Game Reset to Episode 2: Scores wiped, selection cleared.");
              }
            }} 
            style={{ width: '100%', padding: '12px', background: '#ef4444', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '8px', marginBottom: '10px', cursor: 'pointer' }}
          >
            HARD RESET TO EPISODE 2
          </button>
          <button 
            onClick={async () => { 
              await supabase.from('game_settings').update({current_week: currentWeek + 1}).eq('id', 1);
              await supabase.from('contestants').update({is_at_risk: false}).neq('id', 0);
              fetchData();
            }} 
            style={{ width: '100%', padding: '12px', background: '#22c55e', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
          >
            START NEXT EPISODE
          </button>
        </div>
      )}

      {/* TRIBES */}
      {Object.entries(tribes).map(([name, members]) => (
        <div key={name} style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '1rem', color: members[0].tribe_color || '#f97316', borderBottom: '2px solid', paddingBottom: '5px', marginBottom: '15px' }}>{name.toUpperCase()}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            {members.map(c => (
              <div key={c.id} style={{ position: 'relative' }}>
                {isAdmin && (
                  <div style={{ position: 'absolute', top: '-10px', left: '0', right: '0', display: 'flex', justifyContent: 'space-between', zIndex: 10, padding: '0 5px' }}>
                    <button onClick={() => handleEliminate(c.id)} style={{ background: '#ef4444', border: '2px solid white', borderRadius: '50%', width: '32px', height: '32px', color: 'white', fontWeight: 'bold' }}>✕</button>
                    <button onClick={async () => { await supabase.from('contestants').update({is_at_risk: !c.is_at_risk}).eq('id', c.id); fetchData(); }} style={{ background: '#eab308', border: '2px solid white', borderRadius: '50%', width: '32px', height: '32px', fontWeight: 'bold' }}>🔥</button>
                  </div>
                )}
                <button 
                  // Clicking only updates selection if player is at risk OR you are admin
                  onClick={() => (c.is_at_risk || isAdmin) && setSelectedCandidate(c)}
                  style={{ 
                    width: '100%', 
                    padding: 0, 
                    borderRadius: '15px', 
                    overflow: 'hidden', 
                    background: '#0f172a', 
                    border: selectedCandidate?.id === c.id ? '3px solid white' : '1px solid #1e293b', 
                    cursor: (c.is_at_risk || isAdmin) ? 'pointer' : 'default'
                  }}
                >
                  <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '160px', objectFit: 'cover', objectPosition: '50% 15%' }} />
                  <div style={{ padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'white' }}>{c.name.toUpperCase()}</div>
                    <div style={{ fontSize: '0.6rem', color: c.is_at_risk ? '#f97316' : '#475569', fontWeight: 'bold', marginTop: '4px' }}>{c.is_at_risk ? '🔥 AT RISK' : '🛡️ SAFE'}</div>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* GRAVEYARD */}
      <div style={{ marginTop: '50px', textAlign: 'center', borderTop: '1px solid #1e293b', paddingTop: '30px' }}>
        <h3 style={{ fontSize: '0.7rem', color: '#475569', letterSpacing: '4px', marginBottom: '15px' }}>THE GRAVEYARD</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px' }}>
          {graveyard.length > 0 ? graveyard.map(g => (
            <div key={g.id} style={{ opacity: 0.5, textAlign: 'center' }}>
              <img src={g.image_url} alt={g.name} style={{ width: '50px', height: '50px', borderRadius: '50%', objectFit: 'cover', filter: 'grayscale(1)', border: '1px solid #334155' }} />
              <div style={{ fontSize: '0.55rem', marginTop: '5px', color: '#64748b' }}>{g.name.split(' ')[0]}</div>
            </div>
          )) : <div style={{ fontSize: '0.6rem', color: '#1e293b' }}>No eliminations yet</div>}
        </div>
      </div>

      {/* VOTING FOOTER */}
      {!isAdmin && selectedCandidate && selectedCandidate.is_at_risk && !hasVoted && (
        <div style={{ position: 'fixed', bottom: '20px', left: '0', right: '0', display: 'flex', justifyContent: 'center', padding: '0 20px', zIndex: 100 }}>
          <button 
            onClick={async () => {
              const name = localStorage.getItem('survivor_username') || window.prompt("Your Name:");
              if (!name) return;
              localStorage.setItem('survivor_username', name.trim());
              await supabase.from('votes').upsert({ username: name.trim(), contestant_id: selectedCandidate.id, week_number: currentWeek });
              fetchData();
            }} 
            style={{ width: '100%', maxWidth: '400px', padding: '18px', background: '#f97316', color: 'white', borderRadius: '40px', fontWeight: 'bold', border: '2px solid white', boxShadow: '0 8px 20px rgba(0,0,0,0.5)', fontSize: '1rem' }}
          >
            VOTE FOR {selectedCandidate.name.toUpperCase()}
          </button>
        </div>
      )}
      
      {hasVoted && !isAdmin && (
        <div style={{ position: 'fixed', bottom: '25px', left: '0', right: '0', textAlign: 'center' }}>
          <span style={{ background: '#16a34a', color: 'white', padding: '12px 30px', borderRadius: '30px', fontWeight: 'bold', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>✅ VOTE CAST: {selectedCandidate?.name}</span>
        </div>
      )}
    </div>
  );
}