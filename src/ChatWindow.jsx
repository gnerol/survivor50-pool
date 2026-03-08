import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

// A fun list of Survivor-themed emojis!
const EMOJI_LIST = ['🔥', '😱', '👀', '💀', '😂', '🎉', '😡', '🐐', '👑', '🐍', '🌴', '🥥', '🔦', '⛺️', '🥩'];

export default function ChatWindow() {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [floatingEmojis, setFloatingEmojis] = useState([]);
    const [isGifSearchOpen, setIsGifSearchOpen] = useState(false);
    const [gifSearchTerm, setGifSearchTerm] = useState('');
    const [gifs, setGifs] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const messagesEndRef = useRef(null);
    const channelRef = useRef(null); // Critical: Persists the connection
    const GIPHY_API_KEY = 'tKTNLO1nDvV0BegMXRd6elag24mci9fC';

    useEffect(() => {
        const fetchMessages = async () => {
            const { data } = await supabase
                .from('chat_messages')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);
            if (data) setMessages(data.reverse());
        };

        fetchMessages();

        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        // Establish the single source of truth for the real-time channel
        const chatSub = supabase.channel('chat-room')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
                setMessages((prev) => [...prev, payload.new]);

                const myUsername = localStorage.getItem('survivor_username');
                const isFromMe = payload.new.username === myUsername;

                if (!isOpen && !isFromMe) {
                    setUnreadCount((prev) => prev + 1);
                }

                if (!isFromMe && Notification.permission === "granted") {
                    if (!isOpen || document.hidden) {
                        new Notification(`Tribe Chatter: ${payload.new.username}`, {
                            body: payload.new.text || "Sent a GIF 🎬",
                            icon: '/favicon.ico'
                        });
                    }
                }
            })
            .on('broadcast', { event: 'floating-emoji' }, (payload) => {
                // FIXED: Capture the username from the broadcast payload
                triggerFloatingEmoji(payload.payload.emoji, payload.payload.username);
            })
            .subscribe();

        channelRef.current = chatSub;

        return () => {
            supabase.removeChannel(chatSub);
        };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setUnreadCount(0);
        }
    }, [messages, isOpen]);

    useEffect(() => {
        if (!gifSearchTerm) return;
        const delayDebounceFn = setTimeout(async () => {
            try {
                const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${gifSearchTerm}&limit=10`);
                const json = await res.json();
                setGifs(json.data || []);
            } catch (e) {
                console.error("Giphy fetch error:", e);
            }
        }, 500);
        return () => clearTimeout(delayDebounceFn);
    }, [gifSearchTerm]);

    const triggerFloatingEmoji = (emoji, username) => {
        const newEmoji = {
            id: Date.now() + Math.random(),
            emoji,
            username, // Ensure this property exists
            left: Math.random() * 80 + 10
        };
        setFloatingEmojis((prev) => [...prev, newEmoji]);

        setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== newEmoji.id));
        }, 2000);
    };

    const handleEmojiClick = async (emoji) => {
        let myUsername = localStorage.getItem('survivor_username');

        // Scenario B: Reacting before voting/chatting
        if (!myUsername || myUsername.trim() === '') {
            myUsername = window.prompt("Enter a nickname to send reactions:");
            if (!myUsername || !myUsername.trim()) return;
            localStorage.setItem('survivor_username', myUsername.trim());
        }

        const finalName = myUsername.trim();

        // Broadcast to others
        if (channelRef.current) {
            channelRef.current.send({
                type: 'broadcast',
                event: 'floating-emoji',
                payload: { emoji, username: finalName }
            });
        }

        // Show locally
        triggerFloatingEmoji(emoji, finalName);
    };

    const sendMessage = async (text, isGif = false) => {
        if (!text.trim() && !isGif) return;

        let username = localStorage.getItem('survivor_username');
        if (!username) {
            username = window.prompt("Enter a nickname to join the chat:");
            if (!username || !username.trim()) return;
            localStorage.setItem('survivor_username', username.trim());
        }

        await supabase.from('chat_messages').insert([{
            username: username.trim(),
            text: isGif ? '' : text,
            gif_url: isGif ? text : null
        }]);

        setNewMessage('');
        setIsGifSearchOpen(false);
    };

    return (
        <>
            {/* CSS Animation Injection */}
            <style>{`
                @keyframes floatUp {
                    0% { transform: translateY(0); opacity: 1; }
                    100% { transform: translateY(-300px); opacity: 0; }
                }
            `}</style>

            <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>

                {/* FLOATING EMOJI LAYER (Always visible) */}
                <div style={{ position: 'absolute', bottom: '60px', left: '-50px', width: '200px', height: '400px', pointerEvents: 'none', zIndex: 10000 }}>
                    {floatingEmojis.map((e) => (
                        <div key={e.id} style={{
                            position: 'absolute', bottom: '0', left: `${e.left}%`,
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                            animation: 'floatUp 2s ease-out forwards'
                        }}>
                            <span style={{ fontSize: '2.5rem', filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.5))' }}>{e.emoji}</span>
                            {e.username && (
                                <span style={{
                                    fontSize: '0.7rem', color: 'white', background: 'rgba(0,0,0,0.7)',
                                    padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold', whiteSpace: 'nowrap'
                                }}>
                                    {e.username}
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {!isOpen ? (
                    /* CLOSED STATE BUTTON */
                    <button onClick={() => setIsOpen(true)} className="squish-button" style={{
                        background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)',
                        borderRadius: '50%', width: '60px', height: '60px', fontSize: '1.8rem',
                        cursor: 'pointer', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', position: 'relative', border: '1px solid rgba(255,255,255,0.2)'
                    }}>
                        💬
                        {unreadCount > 0 && <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#ef4444', color: 'white', fontSize: '0.8rem', padding: '4px 8px', borderRadius: '50%' }}>{unreadCount}</span>}
                    </button>
                ) : (
                    /* OPEN CHAT WINDOW */
                    <div style={{
                        width: 'calc(100vw - 40px)', maxWidth: '350px', height: '60vh', maxHeight: '500px',
                        background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(12px)',
                        borderRadius: '16px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden'
                    }}>
                        {/* Header */}
                        <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'white', fontWeight: 'bold' }}>Tribe Chat</span>
                            <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                        </div>

                        {/* Messages List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {messages.map((msg, i) => (
                                <div key={i} style={{ alignSelf: msg.username === localStorage.getItem('survivor_username') ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                                    <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '2px', marginLeft: '4px' }}>{msg.username}</div>
                                    <div style={{ background: msg.username === localStorage.getItem('survivor_username') ? '#3b82f6' : '#334155', color: 'white', padding: '8px 12px', borderRadius: '12px' }}>
                                        {msg.gif_url ? <img src={msg.gif_url} alt="GIF" style={{ width: '100%', borderRadius: '8px' }} /> : msg.text}
                                    </div>
                                </div>
                            ))}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Emoji Bar */}
                        <div style={{ display: 'flex', gap: '5px', padding: '8px', overflowX: 'auto', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                            {EMOJI_LIST.map(emoji => (
                                <button key={emoji} onClick={() => handleEmojiClick(emoji)} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer' }}>{emoji}</button>
                            ))}
                        </div>

                        {/* Input Area */}
                        <div style={{ padding: '10px', display: 'flex', gap: '8px' }}>
                            <input
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
                                placeholder="Send a message..."
                                style={{ flex: 1, background: '#1e293b', border: 'none', borderRadius: '8px', padding: '8px', color: 'white' }}
                            />
                            <button onClick={() => sendMessage(newMessage)} style={{ background: '#3b82f6', border: 'none', borderRadius: '8px', color: 'white', padding: '8px 12px' }}>Send</button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}