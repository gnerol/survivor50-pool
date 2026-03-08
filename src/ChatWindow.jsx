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
    const channelRef = useRef(null);
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

        // Single channel subscription stored in Ref
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
                triggerFloatingEmoji(payload.payload.emoji, payload.payload.username);
            })
            .subscribe();

        channelRef.current = chatSub;
        return () => supabase.removeChannel(chatSub);
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
            username,
            left: Math.random() * 80 + 10
        };
        setFloatingEmojis((prev) => [...prev, newEmoji]);
        setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== newEmoji.id));
        }, 2000);
    };

    const handleEmojiClick = async (emoji) => {
        let myUsername = localStorage.getItem('survivor_username');
        if (!myUsername || myUsername.trim() === '') {
            myUsername = window.prompt("Enter a nickname to send reactions:");
            if (!myUsername || !myUsername.trim()) return;
            localStorage.setItem('survivor_username', myUsername.trim());
        }
        const finalName = myUsername.trim();

        if (channelRef.current) {
            channelRef.current.send({
                type: 'broadcast',
                event: 'floating-emoji',
                payload: { emoji, username: finalName }
            });
        }
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

    // Shared Floating Emoji Component to avoid repetition
    const FloatingEmojiLayer = () => (
        <div style={{ position: 'absolute', bottom: '60px', left: '-50px', width: '200px', height: '350px', pointerEvents: 'none', overflow: 'hidden', zIndex: 10 }}>
            {floatingEmojis.map((e) => (
                <div key={e.id} style={{
                    position: 'absolute', bottom: '0', left: `${e.left}%`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    animation: 'floatUp 2s ease-out forwards'
                }}>
                    <span style={{ fontSize: '2.5rem', filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.5))' }}>{e.emoji}</span>
                    {e.username && (
                        <span style={{ fontSize: '0.65rem', color: '#f8fafc', background: 'rgba(0,0,0,0.6)', padding: '2px 8px', borderRadius: '12px', marginTop: '2px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                            {e.username}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );

    if (!isOpen) {
        return (
            <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9990 }}>
                <FloatingEmojiLayer />
                <button onClick={() => setIsOpen(true)} className="squish-button" style={{
                    background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '50%', width: '60px', height: '60px',
                    fontSize: '1.8rem', cursor: 'pointer', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', position: 'relative'
                }}>
                    💬
                    {unreadCount > 0 && (
                        <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#ef4444', color: 'white', fontSize: '0.8rem', fontWeight: 'bold', padding: '4px 8px', borderRadius: '50%', border: '2px solid #0f172a' }}>
                            {unreadCount}
                        </span>
                    )}
                </button>
            </div>
        );
    }

    return (
        <div style={{
            position: 'fixed', bottom: '20px', right: '20px', zIndex: 9990,
            width: 'calc(100vw - 40px)', maxWidth: '350px', height: '60vh', maxHeight: '500px',
            background: 'rgba(15, 23, 42, 0.25)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}>
            <FloatingEmojiLayer />

            {/* Header */}
            <div style={{ padding: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'white', fontWeight: 'bold', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Tribe Chat</span>
                <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ alignSelf: msg.username === localStorage.getItem('survivor_username') ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                        <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.6)', marginBottom: '4px', textAlign: msg.username === localStorage.getItem('survivor_username') ? 'right' : 'left' }}>{msg.username}</div>
                        <div style={{
                            background: msg.username === localStorage.getItem('survivor_username') ? 'rgba(59, 130, 246, 0.5)' : 'rgba(255,255,255,0.1)',
                            padding: '10px 14px', borderRadius: '15px', color: 'white'
                        }}>
                            {msg.gif_url ? <img src={msg.gif_url} alt="GIF" style={{ width: '100%', borderRadius: '10px' }} /> : msg.text}
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* GIF Search Drawer */}
            {isGifSearchOpen && (
                <div style={{ background: 'rgba(0,0,0,0.4)', padding: '10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <input autoFocus placeholder="Search GIFs..." style={{ width: '100%', padding: '8px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', marginBottom: '8px' }}
                        onChange={(e) => setGifSearchTerm(e.target.value)} />
                    <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '5px' }}>
                        {gifs.map(gif => (
                            <img key={gif.id} src={gif.images.fixed_height_small.url} alt="gif" onClick={() => sendMessage(gif.images.fixed_height.url, true)} style={{ height: '60px', borderRadius: '4px', cursor: 'pointer' }} />
                        ))}
                    </div>
                </div>
            )}

            {/* Emoji & Input */}
            <div style={{ padding: '10px', background: 'rgba(0,0,0,0.2)' }}>
                {/* Fixed: Scrollbar enabled for desktop, hidden on mobile via CSS usually but scrollable here */}
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '8px', scrollbarWidth: 'thin' }}>
                    {EMOJI_LIST.map(emoji => (
                        <button key={emoji} onClick={() => handleEmojiClick(emoji)} style={{ background: 'none', border: 'none', fontSize: '1.6rem', cursor: 'pointer', padding: '2px' }}>{emoji}</button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setIsGifSearchOpen(!isGifSearchOpen)} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', color: 'white', padding: '0 12px', cursor: 'pointer' }}>GIF</button>
                    <input
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
                        placeholder="Type a message..."
                        style={{ flex: 1, background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', padding: '10px', color: 'white' }}
                    />
                </div>
            </div>
        </div>
    );
}