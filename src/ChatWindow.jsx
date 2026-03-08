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

    // --- Toggle State for Mobile ---
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

        // --- Ask the user for notification permissions ---
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        const chatSub = supabase.channel('chat-room')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
                setMessages((prev) => [...prev, payload.new]);

                const myUsername = localStorage.getItem('survivor_username');
                const isFromMe = payload.new.username === myUsername;

                // Increment unread count if the chat is closed
                if (!isOpen && !isFromMe) {
                    setUnreadCount((prev) => prev + 1);
                }

                // --- Send the Device Notification ---
                // Only send if it's from someone else, and permission is granted!
                if (!isFromMe && Notification.permission === "granted") {
                    // Only notify if the chat is closed, or they are in a different browser tab
                    if (!isOpen || document.hidden) {
                        new Notification(`Tribe Chatter: ${payload.new.username}`, {
                            body: payload.new.text || "Sent a GIF 🎬",
                            icon: '/favicon.ico' // You can point this to your app's logo image!
                        });
                    }
                }
            })
            .on('broadcast', { event: 'floating-emoji' }, (payload) => {
                // Pass BOTH the emoji and the username from the payload!
                triggerFloatingEmoji(payload.payload.emoji, payload.payload.username);
            })
            .subscribe();

        return () => supabase.removeChannel(chatSub);
    }, [isOpen]);

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

    // --- Floating Emoji Logic (Now actually saving Usernames!) ---
    const triggerFloatingEmoji = (emoji, username) => {
        // We MUST pass "username" into this newEmoji object!
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
        // Check who is sending it
        let myUsername = localStorage.getItem('survivor_username');

        // Prompt if they are anonymous
        if (!myUsername || myUsername.trim() === '') {
            myUsername = window.prompt("Enter a nickname to send reactions:");
            if (!myUsername || !myUsername.trim()) return;
            localStorage.setItem('survivor_username', myUsername.trim());
        }

        const finalName = myUsername.trim() || 'Anonymous';

        // Trigger locally with the name
        triggerFloatingEmoji(emoji, finalName);

        // Broadcast to everyone else with the name
        await supabase.channel('chat-room').send({
            type: 'broadcast',
            event: 'floating-emoji',
            payload: { emoji, username: finalName }
        });
    };

    // --- Floating action button when closed ---
    if (!isOpen) {
        return (
            <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9990 }}>
                {/* Render floating emojis even when chat is closed! */}
                <div style={{ position: 'absolute', bottom: '60px', left: '-50px', width: '150px', height: '300px', pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
                    {floatingEmojis.map((e) => (
                        <div key={e.id} style={{
                            position: 'absolute', bottom: '0', left: `${e.left}%`, display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'floatUp 2s ease-out forwards'
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
            background: 'rgba(15, 23, 42, 0.25)', // Much more transparent
            backdropFilter: 'blur(6px)', // Lowered blur for better visibility
            WebkitBackdropFilter: 'blur(6px)',
            border: '