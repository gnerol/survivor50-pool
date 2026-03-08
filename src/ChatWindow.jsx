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

    // --- NEW: Toggle State for Mobile ---
    const [isOpen, setIsOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const messagesEndRef = useRef(null);
    const GIPHY_API_KEY = 'tKTNLO1nDvV0BegMXRd6elag24mci9fC'; // Keep your key here!

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

        const chatSub = supabase.channel('chat-room')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
                setMessages((prev) => [...prev, payload.new]);
                // Increment unread count if the chat is closed
                if (!isOpen) {
                    setUnreadCount((prev) => prev + 1);
                }
            })
            .on('broadcast', { event: 'floating-emoji' }, (payload) => {
                triggerFloatingEmoji(payload.payload.emoji);
            })
            .subscribe();

        return () => supabase.removeChannel(chatSub);
    }, [isOpen]); // Added isOpen to dependency array

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setUnreadCount(0); // Clear unreads when opened
        }
    }, [messages, isOpen]);

    const sendMessage = async (text, isGif = false) => {
        if (!text.trim() && !isGif) return;

        // Check if we already know who this player is
        let username = localStorage.getItem('survivor_username');

        // If we don't know them, ask for a nickname!
        if (!username) {
            username = window.prompt("Enter a nickname to join the chat:");

            // If they hit cancel or leave it blank, stop the message from sending
            if (!username || !username.trim()) return;

            // Save it so we remember them next time, and so the voting system can use it too!
            localStorage.setItem('survivor_username', username.trim());
        }

        // Send the message to the database
        await supabase.from('chat_messages').insert([{
            username: username.trim(),
            text: isGif ? '' : text,
            gif_url: isGif ? text : null
        }]);

        setNewMessage('');
        setIsGifSearchOpen(false);
    };

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

    const triggerFloatingEmoji = (emoji) => {
        const newEmoji = { id: Date.now() + Math.random(), emoji, left: Math.random() * 80 + 10 };
        setFloatingEmojis((prev) => [...prev, newEmoji]);

        setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== newEmoji.id));
        }, 2000);
    };

    const handleEmojiClick = async (emoji) => {
        triggerFloatingEmoji(emoji);
        await supabase.channel('chat-room').send({
            type: 'broadcast',
            event: 'floating-emoji',
            payload: { emoji }
        });
    };

    // --- NEW: Floating action button when closed ---
    if (!isOpen) {
        return (
            <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9990 }}>
                {/* Render floating emojis even when chat is closed! */}
                <div style={{ position: 'absolute', bottom: '60px', left: '-50px', width: '150px', height: '300px', pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
                    {floatingEmojis.map((e) => (
                        <div key={e.id} style={{ position: 'absolute', bottom: '0', left: `${e.left}%`, fontSize: '2rem', animation: 'floatUp 2s ease-out forwards' }}>
                            {e.emoji}
                        </div>
                    ))}
                </div>

                <button
                    onClick={() => setIsOpen(true)}
                    className="squish-button"
                    style={{
                        background: 'rgba(15, 23, 42, 0.4)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '50%',
                        width: '60px',
                        height: '60px',
                        fontSize: '1.8rem',
                        cursor: 'pointer',
                        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative'
                    }}
                >
                    💬
                    {unreadCount > 0 && (
                        <span style={{
                            position: 'absolute', top: '-5px', right: '-5px', background: '#ef4444', color: 'white', fontSize: '0.8rem', fontWeight: 'bold', padding: '4px 8px', borderRadius: '50%', border: '2px solid #0f172a'
                        }}>
                            {unreadCount}
                        </span>
                    )}
                </button>
            </div>
        );
    }

    // --- Open Chat Window ---
    return (
        <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: 'calc(100vw - 40px)', // Responsive width
            maxWidth: '350px', // Caps out on desktop
            height: '60vh', // Uses viewport height percentage instead of fixed pixels
            maxHeight: '500px',
            background: 'rgba(15, 23, 42, 0.25)', // CHANGED: Much more transparent
            backdropFilter: 'blur(6px)', // CHANGED: Lowered blur for better visibility
            WebkitBackdropFilter: 'blur(6px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '24px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9990,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
        }}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
                {floatingEmojis.map((e) => (
                    <div key={e.id} style={{ position: 'absolute', bottom: '0', left: `${e.left}%`, fontSize: '2rem', animation: 'floatUp 2s ease-out forwards' }}>
                        {e.emoji}
                    </div>
                ))}
            </div>

            {/* Header with Close Button */}
            <div style={{ padding: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', fontWeight: 'bold' }}>Tribe Chatter 💬</h3>
                <button onClick={() => setIsOpen(false)} className="squish-button" style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>

            <div className="survivor-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1 }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ background: 'rgba(0, 0, 0, 0.2)', padding: '10px', borderRadius: '12px' }}>
                        <span style={{ color: '#f97316', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{msg.username}</span>
                        {msg.text && <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{msg.text}</span>}
                        {msg.gif_url && <img src={msg.gif_url} alt="gif" style={{ width: '100%', borderRadius: '8px', marginTop: '5px' }} />}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* CHANGED: Scrollable Emoji List */}
            <div className="hide-scrollbar" style={{ display: 'flex', padding: '10px', gap: '10px', overflowX: 'auto', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {EMOJI_LIST.map(emoji => (
                    <button key={emoji} onClick={() => handleEmojiClick(emoji)} className="squish-button" style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', minWidth: '35px', height: '35px', cursor: 'pointer', fontSize: '1.2rem', flexShrink: 0 }}>
                        {emoji}
                    </button>
                ))}
            </div>

            {isGifSearchOpen && (
                <div style={{ position: 'absolute', bottom: '65px', left: '10px', right: '10px', background: 'rgba(30, 41, 59, 0.9)', backdropFilter: 'blur(10px)', padding: '10px', borderRadius: '16px', zIndex: 10 }}>
                    <input
                        autoFocus
                        placeholder="Search GIFs..."
                        value={gifSearchTerm}
                        onChange={(e) => setGifSearchTerm(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '8px', border: 'none', marginBottom: '10px', boxSizing: 'border-box' }}
                    />
                    <div className="survivor-scrollbar" style={{ display: 'flex', overflowX: 'auto', gap: '5px', paddingBottom: '5px' }}>
                        {gifs.map(gif => (
                            <img
                                key={gif.id}
                                src={gif.images.fixed_height_small.url}
                                alt="gif"
                                onClick={() => sendMessage(gif.images.fixed_height.url, true)}
                                style={{ height: '60px', cursor: 'pointer', borderRadius: '4px' }}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '8px', zIndex: 1 }}>
                <button onClick={() => setIsGifSearchOpen(!isGifSearchOpen)} className="squish-button" style={{ background: 'rgba(59, 130, 246, 0.8)', color: 'white', border: 'none', borderRadius: '8px', padding: '0 10px', cursor: 'pointer', fontWeight: 'bold' }}>GIF</button>
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
                    placeholder="Type a message..."
                    style={{ flex: 1, background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '10px', borderRadius: '8px', outline: 'none' }}
                />
                <button onClick={() => sendMessage(newMessage)} className="squish-button" style={{ background: 'rgba(249, 115, 22, 0.8)', color: 'white', border: 'none', borderRadius: '8px', padding: '0 15px', cursor: 'pointer', fontWeight: 'bold' }}>Send</button>
            </div>
        </div>
    );
}