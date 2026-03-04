import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import confetti from 'canvas-confetti';

export default function App() {
      const [contestants, setContestants] = useState([]);
      const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('is_survivor_admin') === 'true');
      const [scores, setScores] = useState([]);
      const [currentWeek, setCurrentWeek] = useState(2);
      const [selectedCandidate, setSelectedCandidate] = useState(null);
      const [hasVoted, setHasVoted] = useState(false);
      const [voteCount, setVoteCount] = useState(0);
      const [eliminatedPlayer, setEliminatedPlayer] = useState(null);
      const [showRules, setShowRules] = useState(false);

      const [timerEndAt, setTimerEndAt] = useState(null);
      const [secondsLeft, setSecondsLeft] = useState(0);
      const [showTimeAdded, setShowTimeAdded] = useState(false);
      const timerRef = useRef(null);

      const fetchData = useCallback(async () => {
            const { data: c } = await supabase.from('contestants').select('*').order('name');
            const { data: s } = await supabase.from('profiles').select('*').order('points', { ascending: false });
            const { data: g } = await supabase.from('game_settings').select('*').single();

            if (c) setContestants(c);
            if (s) setScores(s);
            if (g) {
                  setCurrentWeek(g.current_week || 2);
                  setTimerEndAt(g.timer_end_at);
            }

            const activeWeek = g?.current_week || currentWeek;
            const { count } = await supabase.from('votes').select('*', { count: 'exact', head: true }).eq('week_number', activeWeek);
            setVoteCount(count || 0);

            const savedEmail = localStorage.getItem('survivor_email');
            if (savedEmail && activeWeek) {
                  const { data: v } = await supabase.from('votes').select('*').eq('email', savedEmail).eq('week_number', activeWeek).maybeSingle();
                  setHasVoted(!!v);
                  if (v && c) setSelectedCandidate(c.find(p => p.id === v.contestant_id));
                  else setSelectedCandidate(null); // Ensure candidate is cleared if no vote found
            } else {
                  // FIX: Ensure UI resets if local memory is empty (like after a hard reset)
                  setHasVoted(false);
                  setSelectedCandidate(null);
            }
      }, [currentWeek]);

      useEffect(() => {
            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = setInterval(() => {
                  if (!timerEndAt) {
                        setSecondsLeft(0);
                        return;
                  }
                  const target = new Date(timerEndAt).getTime();
                  const now = Date.now();
                  const diff = Math.max(0, Math.floor((target - now) / 1000));
                  setSecondsLeft(diff);
            }, 1000);
            return () => clearInterval(timerRef.current);
      }, [timerEndAt]);

      // BIRTHDAY CONFETTI TRIGGER (UPDATED TO CONTINUOUS)
      useEffect(() => {
            const duration = 3 * 1000;
            const end = Date.now() + duration;

            const fireConfetti = () => {
                  confetti({
                        particleCount: 150,
                        spread: 160,
                        origin: { y: 0.3 },
                        zIndex: 10000
                  });
            };

            // Initial fire
            fireConfetti();
            
            // Repeat every 3 seconds
            const interval = setInterval(fireConfetti, 3000);
            
            return () => clearInterval(interval);
      }, []);

      useEffect(() => {
            fetchData();
            const sub = supabase.channel('master-room')
                  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_settings' }, (payload) => {
                        if (payload.new.timer_end_at && payload.new.timer_end_at !== payload.old?.timer_end_at) {
                              setShowTimeAdded(true);
                              setTimeout(() => setShowTimeAdded(false), 3000);
                        }
                        setTimerEndAt(payload.new.timer_end_at);
                        fetchData();
                  })
                  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contestants' }, (payload) => {
                        if (payload.new.is_eliminated && !payload.old.is_eliminated) {
                              setEliminatedPlayer(payload.new.name);
                              setTimeout(() => setEliminatedPlayer(null), 5000);
                        }
                        fetchData();
                  })
                  .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData())
                  .subscribe();
            return () => supabase.removeChannel(sub);
      }, [fetchData]);

      const adjustTimer = async (secondsToAdd) => {
            const now = Date.now();
            const base = (timerEndAt && new Date(timerEndAt).getTime() > now) ? new Date(timerEndAt).getTime() : now;
            const newTarget = new Date(base + secondsToAdd * 1000).toISOString();
            await supabase.from('game_settings').update({ timer_end_at: newTarget }).neq('id', -1);
      };

      const handleAdminToggle = () => {
            if (isAdmin) { setIsAdmin(false); sessionStorage.removeItem('is_survivor_admin'); }
            else {
                  const code = window.prompt("Admin Code:");
                  if (code === "SURVIVOR50") { setIsAdmin(true); sessionStorage.setItem('is_survivor_admin', 'true'); }
            }
      };

      const handleEliminate = async (id) => {
            if (!window.confirm("Snuff torch?")) return;
            await supabase.from('contestants').update({ is_eliminated: true, is_at_risk: false, is_immune: false }).eq('id', id);
            const { data: weekVotes } = await supabase.from('votes').select('*').eq('week_number', currentWeek);
            if (weekVotes) {
                  for (const v of weekVotes) {
                        const pts = (v.contestant_id === id) ? 10 : -2;
                        const { data: p } = await supabase.from('profiles').select('points').eq('email', v.email).maybeSingle();
                        await supabase.from('profiles').upsert({ email: v.email, username: v.username, points: (p?.points || 0) + pts }, { onConflict: 'email' });
                  }
            }
            fetchData();
      };

      const atRiskLegends = contestants.filter(c => c.is_at_risk && !c.is_eliminated);
      const isVotingPhase = atRiskLegends.length > 0;
      const isVotingLocked = timerEndAt && secondsLeft === 0;
      const tribes = contestants.filter(c => !c.is_eliminated).reduce((acc, c) => {
            const t = c.tribe_name || 'Merge';
            if (!acc[t]) acc[t] = [];
            acc[t].push(c);
            return acc;
      }, {});
      const graveyard = contestants.filter(c => c.is_eliminated);

      return (
            <div style={{ backgroundColor: '#020617', color: 'white', minHeight: '100vh', width: '100%', boxSizing: 'border-box', overflowX: 'hidden', paddingBottom: '180px' }}>

                  {/* ELIMINATION OVERLAY */}
                  {eliminatedPlayer && (
                        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.95)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', animation: 'fadeIn 0.5s ease' }}>
                              <h2 style={{ color: '#64748b', letterSpacing: '8px', fontSize: '1rem', marginBottom: '10px' }}>THE TRIBE HAS SPOKEN</h2>
                              <h1 style={{ color: '#f97316', fontSize: '3rem', fontWeight: '900', textShadow: '0 0 20px rgba(249, 115, 22, 0.6)' }}>{eliminatedPlayer.toUpperCase()}</h1>
                              <div style={{ marginTop: '20px', fontSize: '2rem' }}>🔥💨</div>
                        </div>
                  )}

                  {/* TIME ADDED OVERLAY */}
                  {showTimeAdded && (
                        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', background: '#f97316', color: 'white', padding: '10px 25px', borderRadius: '50px', fontWeight: 'bold', zIndex: 1000, boxShadow: '0 0 20px rgba(249, 115, 22, 0.5)' }}>
                              ⏳ TIME EXTENDED!
                        </div>
                  )}

                  {/* RULES / HOW TO PLAY OVERLAY */}
                  {showRules && (
                        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 6, 23, 0.95)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', animation: 'fadeIn 0.3s ease' }}>
                              <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '24px', padding: '30px', maxWidth: '500px', width: '100%', position: 'relative', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>
                                    <button onClick={() => setShowRules(false)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: '#64748b', fontSize: '1.5rem', cursor: 'pointer' }}>✕</button>

                                    <h2 style={{ color: '#f97316', marginTop: 0, marginBottom: '20px', fontSize: '1.8rem', fontWeight: '900', letterSpacing: '1px' }}>📜 HOW TO PLAY</h2>

                                    <ul style={{ color: '#e2e8f0', lineHeight: '1.6', fontSize: '1.05rem', paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                          <li><strong>First Vote:</strong> Enter a unique email and nickname. This saves your score for the whole season!</li>
                                          <li><strong>One Vote Per Week:</strong> You get exactly one vote per episode to guess who gets their torch snuffed.</li>
                                          <li><strong>Beat the Clock ⏳:</strong> Once the countdown hits zero, voting is locked. No exceptions!</li>
                                          <li><strong>Scoring 🎯:</strong> Earn <span style={{ color: '#22c55e', fontWeight: 'bold' }}>+10</span> points for a correct guess, but lose <span style={{ color: '#ef4444', fontWeight: 'bold' }}>-2</span> points for a wrong guess.</li>
                                          <li><strong>Browser Warning 🛑:</strong> Do not play in Incognito or Private mode, or your browser won't remember you next week.</li>
                                    </ul>

                                    <button onClick={() => setShowRules(false)} style={{ width: '100%', background: '#3b82f6', color: 'white', border: 'none', padding: '15px', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 'bold', marginTop: '30px', cursor: 'pointer', transition: '0.2s' }}>
                                          GOT IT, LET'S PLAY!
                                    </button>
                              </div>
                        </div>
                  )}

                  {/* HEADER */}
                  <div style={{ padding: '20px 15px', maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
                        <div>
                              <h1 style={{
                                    color: '#f97316',
                                    fontSize: 'clamp(1.1rem, 5vw, 1.8rem)',
                                    margin: 0,
                                    fontWeight: '900',
                                    letterSpacing: '1px',
                                    whiteSpace: 'nowrap'
                              }}>
                                    SURVIVOR 50 <span style={{ color: '#64748b', fontWeight: '400' }}>—</span> EPISODE {currentWeek}
                              </h1>
                              {isAdmin && <div style={{ fontSize: '0.8rem', color: '#22c55e', fontWeight: 'bold', marginTop: '4px' }}>{voteCount} VOTES COLLECTED</div>}
                        </div>

                        <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                              <button onClick={() => setShowRules(true)} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '12px 16px', borderRadius: '12px', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold' }}>
                                    ❓ Rules
                              </button>
                              <button onClick={handleAdminToggle} style={{ background: '#1e293b', border: 'none', padding: '12px', borderRadius: '12px', fontSize: '1.4rem', cursor: 'pointer' }}>
                                    {isAdmin ? '🔒' : '🛠️'}
                              </button>
                        </div>
                  </div>

                  <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 15px' }}>
                        {/* BIRTHDAY ANNOUNCEMENT BANNER */}
                        <div style={{
                              margin: '10px 15px 25px 15px',
                              padding: '15px 20px',
                              background: 'rgba(249, 115, 22, 0.15)',
                              border: '1px solid #f97316',
                              borderRadius: '16px',
                              textAlign: 'center',
                              boxShadow: '0 4px 15px rgba(249, 115, 22, 0.2)'
                        }}>
                              <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>
                                    🕯️🎂🎈
                              </div>
                              <p style={{
                                    margin: 0,
                                    fontSize: '0.9rem',
                                    color: '#f8fafc',
                                    lineHeight: '1.5',
                                    fontWeight: '600',
                                    letterSpacing: '0.5px'
                              }}>
                                    Welcome to our Survivor50! The first vote is live March 4th.<br />
                                    <span style={{
                                          color: '#f97316',
                                          fontWeight: '900',
                                          fontSize: 'clamp(1rem, 4.5vw, 1.2rem)',
                                          marginTop: '5px',
                                          whiteSpace: 'nowrap',
                                          display: 'inline-block'
                                    }}>
                                          🎉 HAPPY BIRTHDAY RAYA! 🎉
                                    </span>
                              </p>
                        </div>

                        {/* LEADERBOARD */}
                        <div style={{ background: '#0f172a', padding: '20px', borderRadius: '24px', border: '1px solid #1e293b', marginBottom: '30px' }}>
                              <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '15px', letterSpacing: '3px', fontWeight: 'bold' }}>CURRENT STANDINGS</div>
                              <div className="custom-scrollbar" style={{ maxHeight: '106px', overflowY: 'auto', paddingRight: '10px' }}>
                                    {scores.length > 0 ? (
                                          (() => {
                                                const topScore = scores[0].points;
                                                const isTieForFirst = scores.filter(s => s.points === topScore).length > 1;

                                                return scores.map((s, i) => (
                                                      <div key={i} style={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            fontSize: '1.1rem',
                                                            height: '52px',
                                                            borderBottom: '1px solid #1e293b'
                                                      }}>
                                                            <span style={{ fontWeight: '600', color: '#f8fafc' }}>
                                                                  {i === 0 && !isTieForFirst && <span style={{ marginRight: '8px' }}>👑</span>}
                                                                  {s.username}
                                                            </span>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                                  <span style={{ color: s.points >= 0 ? '#22c55e' : '#ef4444', fontWeight: '900', fontSize: '1.2rem' }}>{s.points}</span>
                                                                  <span style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 'bold' }}>PTS</span>
                                                            </div>
                                                      </div>
                                                ));
                                          })()
                                    ) : (
                                          <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#475569', padding: '20px 0' }}>No active players.</div>
                                    )}
                              </div>
                        </div>

                        {/* ADMIN PANEL */}
                        {isAdmin && (
                              <div style={{ border: '2px solid #ef4444', padding: '15px', borderRadius: '20px', marginBottom: '30px', background: 'rgba(239, 68, 68, 0.1)' }}>
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                          <button onClick={() => adjustTimer(60)} style={{ flex: 1, padding: '10px', background: '#f97316', color: 'white', borderRadius: '8px', border: 'none', fontWeight: 'bold' }}>+1 MIN</button>
                                          <button onClick={() => adjustTimer(15)} style={{ flex: 1, padding: '10px', background: '#eab308', color: 'black', borderRadius: '8px', border: 'none', fontWeight: 'bold' }}>+15 SEC</button>
                                    </div>
                                    <button
                                          onClick={async () => {
                                                if (!window.confirm("RESET ENTIRE GAME? This deletes all votes and points!")) return;
                                                try {
                                                      const { error } = await supabase.rpc('season_hard_reset');
                                                      if (error) throw error;

                                                      localStorage.removeItem('survivor_email');
                                                      localStorage.removeItem('survivor_username');

                                                      // FIX: Force reload to clear all React state and memory instantly
                                                      window.location.reload();
                                                } catch (err) { alert(err.message); }
                                          }}
                                          style={{ width: '100%', padding: '10px', background: '#ef4444', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '12px', marginBottom: '10px', fontSize: '0.7rem', cursor: 'pointer' }}
                                    >
                                          HARD RESET GAME
                                    </button>
                                    <button
                                          onClick={async () => {
                                                await supabase.from('game_settings').update({ current_week: currentWeek + 1, timer_end_at: null }).neq('id', -1);
                                                await supabase.from('contestants').update({ is_at_risk: false, is_immune: false }).eq('is_eliminated', false);
                                                fetchData();
                                          }}
                                          style={{ width: '100%', padding: '14px', background: '#22c55e', color: 'white', fontWeight: 'bold', border: 'none', borderRadius: '12px' }}
                                    >
                                          START NEXT EPISODE
                                    </button>
                              </div>
                        )}

                        {/* MAIN CONTENT */}
                        {isVotingPhase ? (
                              <div style={{ marginBottom: '40px', textAlign: 'center' }}>
                                    <div style={{ marginBottom: '25px' }}>
                                          <h2 style={{ fontSize: '1.4rem', color: '#ef4444', margin: 0, letterSpacing: '3px', fontWeight: '900' }}>🔥 TRIBAL COUNCIL 🔥</h2>

                                          {timerEndAt && secondsLeft > 0 ? (
                                                <div style={{ color: secondsLeft < 15 ? '#ef4444' : '#f97316', fontSize: '3rem', fontWeight: 'bold', margin: '10px 0', fontFamily: 'monospace' }}>
                                                      {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                                                </div>
                                          ) : isVotingLocked ? (
                                                <div style={{ background: '#ef4444', color: 'white', display: 'inline-block', padding: '5px 20px', borderRadius: '8px', fontWeight: 'bold', margin: '15px 0', letterSpacing: '1px' }}>
                                                      VOTING LOCKED - AWAITING REVEAL
                                                </div>
                                          ) : null}

                                          <p style={{ color: '#64748b', fontSize: '0.8rem' }}>
                                                {secondsLeft > 0 ? "The voting window is closing..." : isVotingLocked ? "All votes are in. The tribe has spoken." : "Cast your vote for the reveal!"}
                                          </p>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' }}>
                                          {atRiskLegends.map(c => (
                                                <div key={c.id} style={{ position: 'relative' }}>
                                                      {isAdmin && (
                                                            <div style={{ position: 'absolute', top: '-8px', left: '0', right: '0', display: 'flex', justifyContent: 'space-between', zIndex: 10, padding: '0 5px' }}>
                                                                  <button onClick={() => handleEliminate(c.id)} style={{ background: '#ef4444', border: '2px solid #020617', borderRadius: '50%', width: '32px', height: '32px', color: 'white', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                                                                  <div style={{ display: 'flex', gap: '5px' }}>
                                                                        {/* HIDDEN IMMUNITY IDOL TOGGLE */}
                                                                        <button 
                                                                              onClick={async () => { await supabase.from('contestants').update({ is_immune: !c.is_immune }).eq('id', c.id); fetchData(); }} 
                                                                              style={{ background: c.is_immune ? '#eab308' : '#1e293b', border: '2px solid #eab308', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                              title="Play Hidden Immunity"
                                                                        >
                                                                              🗿
                                                                        </button>
                                                                        {/* RETURN TO CAMP SAFE TOGGLE */}
                                                                        <button onClick={async () => { await supabase.from('contestants').update({ is_at_risk: false }).eq('id', c.id); fetchData(); }} style={{ background: '#eab308', border: '2px solid #020617', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🛡️</button>
                                                                  </div>
                                                            </div>
                                                      )}
                                                      <button
                                                            disabled={(isVotingLocked && !isAdmin) || c.is_immune || hasVoted}
                                                            onClick={() => !hasVoted && !c.is_immune && setSelectedCandidate(selectedCandidate?.id === c.id ? null : c)}
                                                            style={{
                                                                  width: '100%', padding: 0, borderRadius: '24px', overflow: 'hidden', background: '#0f172a',
                                                                  border: c.is_immune ? '4px solid #eab308' : (selectedCandidate?.id === c.id ? '4px solid #f97316' : '2px solid #ef4444'),
                                                                  transition: '0.3s',
                                                                  opacity: (isVotingLocked && !isAdmin) || c.is_immune ? 0.6 : 1,
                                                                  cursor: (isVotingLocked && !isAdmin) || c.is_immune || hasVoted ? 'not-allowed' : 'pointer',
                                                                  position: 'relative'
                                                            }}
                                                      >
                                                            {c.is_immune && (
                                                                  <div style={{ position: 'absolute', top: '10px', right: '10px', background: '#eab308', color: 'black', padding: '4px 8px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: '900', zIndex: 20 }}>
                                                                        🛡️ IMMUNE
                                                                  </div>
                                                            )}
                                                            <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '220px', objectFit: 'cover', objectPosition: 'top' }} />
                                                            <div style={{ padding: '15px', background: 'linear-gradient(to bottom, #1e1b4b, #0f172a)' }}>
                                                                  <div style={{ fontWeight: '900', color: c.is_immune ? '#eab308' : 'white' }}>{c.name.toUpperCase()}</div>
                                                            </div>
                                                      </button>
                                                </div>
                                          ))}
                                    </div>

                                    {isAdmin && (
                                          <button
                                                onClick={async () => {
                                                      setContestants(contestants.map(p => ({ ...p, is_at_risk: false, is_immune: false })));
                                                      await supabase.from('contestants').update({ is_at_risk: false, is_immune: false }).eq('is_eliminated', false);
                                                      await supabase.from('game_settings').update({ timer_end_at: null }).neq('id', -1);
                                                }}
                                                style={{ width: '100%', marginTop: '30px', background: 'transparent', border: '1px solid #334155', color: '#64748b', padding: '12px', borderRadius: '12px', cursor: 'pointer' }}
                                          >
                                                RETURN ALL TO CAMP
                                          </button>
                                    )}
                              </div>
                        ) : (
                              Object.entries(tribes).map(([name, members]) => (
                                    <div key={name} style={{ marginBottom: '40px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                                                <h2 style={{ fontSize: '1.1rem', color: members[0].tribe_color || '#f97316' }}>{name.toUpperCase()}</h2>
                                                {isAdmin && (
                                                      <button
                                                            onClick={async () => {
                                                                  setContestants(contestants.map(p => p.tribe_name === name && !p.is_eliminated ? { ...p, is_at_risk: true } : p));
                                                                  await supabase.from('contestants').update({ is_at_risk: true }).eq('tribe_name', name).eq('is_eliminated', false);
                                                            }}
                                                            style={{ background: '#334155', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '6px', fontSize: '0.7rem', cursor: 'pointer' }}
                                                      >
                                                            SEND TRIBE TO COUNCIL
                                                      </button>
                                                )}
                                          </div>
                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '15px' }}>
                                                {members.map(c => (
                                                      <div key={c.id} style={{ position: 'relative' }}>
                                                            {isAdmin && (
                                                                  <div style={{ position: 'absolute', top: '-8px', right: '5px', zIndex: 10, display: 'flex', gap: '4px' }}>
                                                                        <button
                                                                              onClick={async () => { await supabase.from('contestants').update({ is_immune: !c.is_immune }).eq('id', c.id); fetchData(); }}
                                                                              style={{ background: '#1e293b', border: '2px solid #eab308', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontSize: '0.8rem' }}
                                                                        >🏆</button>
                                                                        <button onClick={async () => { await supabase.from('contestants').update({ is_at_risk: true }).eq('id', c.id); fetchData(); }} style={{ background: '#eab308', border: '2px solid #020617', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer' }}>🔥</button>
                                                                  </div>
                                                            )}

                                                            {c.is_immune && (
                                                                  <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 5, background: 'rgba(234, 179, 8, 0.9)', color: 'black', padding: '4px 8px', borderRadius: '8px', fontSize: '0.7rem', fontWeight: '900', boxShadow: '0 0 10px #eab308' }}>
                                                                        🛡️ IMMUNE
                                                                  </div>
                                                            )}

                                                            <div style={{ borderRadius: '20px', overflow: 'hidden', background: '#0f172a', border: c.is_immune ? '2px solid #eab308' : '1px solid #1e293b', opacity: 0.8 }}>
                                                                  <img src={c.image_url} alt={c.name} style={{ width: '100%', height: '180px', objectFit: 'cover', objectPosition: 'top' }} />
                                                                  <div style={{ padding: '12px', textAlign: 'center', fontWeight: c.is_immune ? '900' : '400', color: c.is_immune ? '#eab308' : 'white' }}>{c.name.toUpperCase()}</div>
                                                            </div>
                                                      </div>
                                                ))}
                                          </div>
                                    </div>
                              ))
                        )}

                        {/* GRAVEYARD */}
                        <div style={{ marginTop: '50px', padding: '30px', backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: '24px', border: '1px dashed #334155' }}>
                              <h3 style={{ fontSize: '1rem', textAlign: 'center', color: '#94a3b8', marginBottom: '25px', letterSpacing: '6px', fontWeight: '900' }}>THE GRAVEYARD</h3>
                              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '20px' }}>
                                    {graveyard.map(g => (
                                          <div key={g.id} style={{ textAlign: 'center', width: '85px' }}>
                                                <div style={{ width: '75px', height: '75px', borderRadius: '50%', overflow: 'hidden', filter: 'grayscale(1) brightness(0.7)', border: '3px solid #1e293b', marginBottom: '8px' }}>
                                                      <img src={g.image_url} alt={g.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase' }}>{g.name.split(' ')[0]}</div>
                                          </div>
                                    ))}
                              </div>
                        </div>
                  </div>

                  {/* VOTING FOOTER */}
                  {!isAdmin && selectedCandidate && selectedCandidate.is_at_risk && !hasVoted && !isVotingLocked && !selectedCandidate.is_immune && (
                        <div style={{ position: 'fixed', bottom: '0', left: '0', right: '0', padding: '25px', background: 'linear-gradient(to top, #020617 70%, transparent)', display: 'flex', justifyContent: 'center', zIndex: 100 }}>
                              <button
                                    onClick={async () => {
                                          let email = localStorage.getItem('survivor_email');
                                          let username = localStorage.getItem('survivor_username');

                                          if (!email) {
                                                const inputEmail = window.prompt("Enter your email to vote:");
                                                if (!inputEmail) {
                                                      setSelectedCandidate(null);
                                                      return;
                                                }
                                                email = inputEmail.toLowerCase().trim();

                                                const { data: existingVote } = await supabase
                                                      .from('votes')
                                                      .select('*')
                                                      .eq('email', email)
                                                      .eq('week_number', currentWeek)
                                                      .maybeSingle();

                                                if (existingVote) {
                                                      window.alert("Welcome back! We found your vote for this week. Your session has been restored.");

                                                      const { data: profile } = await supabase.from('profiles').select('username').eq('email', email).maybeSingle();

                                                      localStorage.setItem('survivor_email', email);
                                                      localStorage.setItem('survivor_username', profile?.username || email);

                                                      fetchData();
                                                      return;
                                                }

                                                username = window.prompt("Enter a nickname for the leaderboard:") || email;
                                                localStorage.setItem('survivor_email', email);
                                                localStorage.setItem('survivor_username', username);
                                          }

                                          await supabase.from('votes').upsert({ email, username, contestant_id: selectedCandidate.id, week_number: currentWeek }, { onConflict: 'email, week_number' });
                                          fetchData();
                                    }}
                                    style={{ width: '100%', maxWidth: '400px', padding: '20px', background: '#f97316', color: 'white', borderRadius: '50px', fontWeight: '900', border: 'none', cursor: 'pointer' }}
                              >
                                    VOTE FOR {selectedCandidate.name.toUpperCase()}
                              </button>
                        </div>
                  )}

                  {hasVoted && !isAdmin && isVotingPhase && (
                        <div style={{ position: 'fixed', bottom: '30px', left: '0', right: '0', textAlign: 'center', zIndex: 100 }}>
                              <span style={{ background: '#22c55e', color: 'white', padding: '15px 35px', borderRadius: '50px', fontWeight: '900' }}>
                                    ✅ VOTE CAST: {selectedCandidate?.name?.toUpperCase()}
                              </span>
                        </div>
                  )}
            </div>
      );
}