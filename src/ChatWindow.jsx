import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

export default function ChatWindow() {
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [floatingEmojis, setFloatingEmojis] = useState([]);
    const [isGifSearchOpen, setIsGifSearchOpen] = useState(false);
    const [gifSearchTerm, setGifSearchTerm] = useState('');
    const [gifs, setGifs] = useState([]);
    const messagesEndRef = useRef(null);

    const GIPHY_API_KEY = 'tKTNLO1nDvV0BegMXRd6elag24mci9fC'; // We will need to replace this!

    // --- 1. Fetch and Sync Messages ---
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
            })
            .on('broadcast', { event: 'floating-emoji' }, (payload) => {
                triggerFloatingEmoji(payload.payload.emoji);
            })
            .subscribe();

        return () => supabase.removeChannel(chatSub);
    }, []);

    // Scroll to bottom on new message
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // --- 2. Message Sending ---
    const sendMessage = async (text, isGif = false) => {
        if (!text.trim() && !isGif) return;
        const username = localStorage.getItem('survivor_username') || 'Anonymous';

        await supabase.from('chat_messages').insert([{
            username,
            text: isGif ? '' : text,
            gif_url: isGif ? text : null
        }]);

        setNewMessage('');
        setIsGifSearchOpen(false);
    };

    // --- 3. Giphy Search ---
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
        }, 500); // Debounce to prevent too many API calls
        return () => clearTimeout(delayDebounceFn);
    }, [gifSearchTerm]);

    // --- 4. Floating Emoji Logic ---
    const triggerFloatingEmoji = (emoji) => {
        const newEmoji = { id: Date.now() + Math.random(), emoji, left: Math.random() * 80 + 10 };
        setFloatingEmojis((prev) => [...prev, newEmoji]);

        // Remove emoji after animation completes (2 seconds)
        setTimeout(() => {
            setFloatingEmojis((prev) => prev.filter((e) => e.id !== newEmoji.id));
        }, 2000);
    };

    const handleEmojiClick = async (emoji) => {
        triggerFloatingEmoji(emoji);
        // Broadcast emoji to other players
        await supabase.channel('chat-room').send({
            type: 'broadcast',
            event: 'floating-emoji',
            payload: { emoji }
        });
    };

    return (
        <div style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            width: '320px',
            height: '450px',
            background: 'rgba(15, 23, 42, 0.6)', // Translucent dark background
            backdropFilter: 'blur(16px)', // Frosted glass effect
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '24px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9990,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            overflow: 'hidden'
        }}>
            {/* Floating Emojis Container */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
                {floatingEmojis.map((e) => (
                    <div key={e.id} className="float-up" style={{
                        position: 'absolute',
                        bottom: '0',
                        left: `${e.left}%`,
                        fontSize: '2rem',
                        animation: 'floatUp 2s ease-out forwards'
                    }}>
                        {e.emoji}
                    </div>
                ))}
            </div>

            {/* Header */}
            <div style={{ padding: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', fontWeight: 'bold' }}>Tribe Chatter 💬</h3>
            </div>

            {/* Message List */}
            <div className="survivor-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1 }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '12px' }}>
                        <span style={{ color: '#f97316', fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>{msg.username}</span>
                        {msg.text && <span style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>{msg.text}</span>}
                        {msg.gif_url && <img src={msg.gif_url} alt="gif" style={{ width: '100%', borderRadius: '8px', marginTop: '5px' }} />}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Quick Reactions */}
            <div style={{ display: 'flex', padding: '10px', gap: '10px', justifyContent: 'center', zIndex: 1 }}>
                {['🔥', '😱', '👀', '💀'].map(emoji => (
                    <button key={emoji} onClick={() => handleEmojiClick(emoji)} className="squish-button" style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%', width: '35px', height: '35px', cursor: 'pointer', fontSize: '1.2rem' }}>
                        {emoji}
                    </button>
                ))}
            </div>

            {/* GIF Search Overlay */}
            {isGifSearchOpen && (
                <div style={{ position: 'absolute', bottom: '65px', left: '10px', right: '10px', background: '#1e293b', padding: '10px', borderRadius: '16px', zIndex: 10 }}>
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

            {/* Input Area */}
            <div style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', gap: '8px', zIndex: 1 }}>
                <button onClick={() => setIsGifSearchOpen(!isGifSearchOpen)} className="squish-button" style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '0 10px', cursor: 'pointer', fontWeight: 'bold' }}>GIF</button>
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendMessage(newMessage)}
                    placeholder="Type a message..."
                    style={{ flex: 1, background: 'rgba(0,0,0,0.3)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', padding: '10px', borderRadius: '8px', outline: 'none' }}
                />
                <button onClick={() => sendMessage(newMessage)} className="squish-button" style={{ background: '#f97316', color: 'white', border: 'none', borderRadius: '8px', padding: '0 15px', cursor: 'pointer', fontWeight: 'bold' }}>Send</button>
            </div>
        </div>
    );
}