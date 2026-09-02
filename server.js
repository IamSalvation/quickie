const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ===== STORES =====
const userStore = new Map(); // phoneNumber -> { pin, name, socketId, chats, pendingRequests }
const chatStore = new Map(); // chatId -> { participants: [pin1, pin2], messages: [] }
const pendingStore = new Map(); // requestId -> { fromPin, toPin, fromName, timestamp }

// ===== HELPER FUNCTIONS =====
function generatePIN() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let pin = '';
    for (let i = 0; i < 8; i++) {
        pin += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pin;
}

function isPINUnique(pin) {
    for (const [phone, user] of userStore) {
        if (user.pin === pin) return false;
    }
    return true;
}

function getUniquePIN() {
    let pin = generatePIN();
    let attempts = 0;
    while (!isPINUnique(pin) && attempts < 100) {
        pin = generatePIN();
        attempts++;
    }
    return pin;
}

function formatPhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 0) return phone;
    if (cleaned.length <= 3) return '+' + cleaned;
    if (cleaned.length <= 6) return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3);
    if (cleaned.length <= 9) return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6);
    return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6, 10);
}

// ===== API ROUTES =====

app.get('/pin', (req, res) => {
    const phone = req.query.phone;
    const action = req.query.action || 'generate';

    if (!phone) {
        return res.status(400).json({ error: 'Phone number required' });
    }

    const cleanPhone = phone.replace(/\s/g, '').replace(/-/g, '');

    if (userStore.has(cleanPhone)) {
        const user = userStore.get(cleanPhone);
        if (action === 'recover') {
            return res.json({
                pin: user.pin,
                exists: true,
                message: 'PIN recovered successfully'
            });
        } else {
            return res.json({
                pin: user.pin,
                exists: true,
                message: 'PIN already exists for this number'
            });
        }
    }

    if (action === 'generate') {
        const pin = getUniquePIN();
        userStore.set(cleanPhone, {
            pin: pin,
            name: '',
            socketId: null,
            chats: [],
            pendingRequests: []
        });
        return res.json({
            pin: pin,
            exists: false,
            message: 'New PIN generated successfully'
        });
    }

    if (action === 'recover') {
        return res.status(404).json({ error: 'Phone number not found' });
    }

    return res.status(400).json({ error: 'Invalid action' });
});

app.get('/user/:pin', (req, res) => {
    const { pin } = req.params;
    let foundUser = null;
    let foundPhone = null;

    for (const [phone, user] of userStore) {
        if (user.pin === pin) {
            foundUser = user;
            foundPhone = phone;
            break;
        }
    }

    if (!foundUser) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json({
        pin: foundUser.pin,
        phone: foundPhone,
        name: foundUser.name || 'User',
        chats: foundUser.chats || []
    });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ===== REGISTER USER =====
    socket.on('register', ({ pin, phone, name }) => {
        let foundPhone = null;
        let user = null;

        for (const [phone, u] of userStore) {
            if (u.pin === pin) {
                foundPhone = phone;
                user = u;
                break;
            }
        }

        if (!user) {
            return socket.emit('error', 'Invalid PIN');
        }

        user.socketId = socket.id;
        if (name) user.name = name;
        userStore.set(foundPhone, user);

        socket.join(`user_${pin}`);
        console.log(`✅ User ${pin} joined room user_${pin}`);

        console.log(`✅ User ${pin} registered (${user.name || 'No name'})`);
        socket.emit('registered', {
            pin,
            name: user.name,
            phone: formatPhoneNumber(foundPhone)
        });

        const pending = [];
        for (const [key, req] of pendingStore) {
            if (req.toPin === pin) {
                pending.push({ fromPin: req.fromPin, fromName: req.fromName, timestamp: req.timestamp });
            }
        }
        if (pending.length > 0) {
            console.log(`📨 Sending ${pending.length} pending requests to ${pin}`);
            socket.emit('pending-requests', pending);
        }
    });

    // ===== GET PENDING REQUESTS =====
    socket.on('get-pending-requests', ({ pin }) => {
        const pending = [];
        for (const [key, req] of pendingStore) {
            if (req.toPin === pin) {
                pending.push({ fromPin: req.fromPin, fromName: req.fromName, timestamp: req.timestamp });
            }
        }
        socket.emit('pending-requests', pending);
    });

    // ===== UPDATE NAME =====
    socket.on('update-name', ({ pin, name }) => {
        let foundPhone = null;
        for (const [phone, user] of userStore) {
            if (user.pin === pin) {
                foundPhone = phone;
                user.name = name;
                userStore.set(phone, user);
                break;
            }
        }
        socket.emit('name-updated', { name });
    });

    // ===== SEND FRIEND REQUEST =====
    socket.on('send-request', ({ fromPin, toPin, fromName }) => {
        console.log(`📤 SEND REQUEST: ${fromPin} -> ${toPin}`);

        let toUser = null;
        let toPhone = null;
        for (const [phone, user] of userStore) {
            if (user.pin === toPin) {
                toUser = user;
                toPhone = phone;
                break;
            }
        }

        if (!toUser) {
            console.log(`❌ User not found: ${toPin}`);
            return socket.emit('error', 'User not found');
        }
        if (fromPin === toPin) {
            return socket.emit('error', 'Cannot add yourself');
        }

        let fromUser = null;
        for (const [phone, user] of userStore) {
            if (user.pin === fromPin) {
                fromUser = user;
                break;
            }
        }

        if (fromUser && fromUser.chats && fromUser.chats.some(c => c.pin === toPin)) {
            return socket.emit('error', 'Already friends');
        }

        for (const [key, req] of pendingStore) {
            if ((req.fromPin === fromPin && req.toPin === toPin) ||
                (req.fromPin === toPin && req.toPin === fromPin)) {
                return socket.emit('error', 'Request already pending');
            }
        }

        const requestId = `req_${Date.now()}`;
        pendingStore.set(requestId, {
            fromPin,
            toPin,
            fromName: fromName || 'User',
            timestamp: Date.now()
        });

        console.log(`✅ Request created: ${requestId}`);
        console.log(`📨 Notifying ${toPin}...`);

        io.to(`user_${toPin}`).emit('new-request', {
            fromPin,
            fromName: fromName || 'User',
            timestamp: Date.now()
        });

        if (toUser && toUser.socketId) {
            const targetSocket = io.sockets.sockets.get(toUser.socketId);
            if (targetSocket) {
                targetSocket.emit('new-request', {
                    fromPin,
                    fromName: fromName || 'User',
                    timestamp: Date.now()
                });
                console.log(`✅ Direct emit to socket: ${toUser.socketId}`);
            } else {
                console.log(`⚠️ Socket ${toUser.socketId} not found`);
            }
        } else {
            console.log(`⚠️ User ${toPin} has no socket ID`);
        }

        socket.emit('request-sent', { toPin, toName: toUser.name || 'User' });
        console.log(`✅ Request sent confirmation to ${fromPin}`);
    });

    // ===== ACCEPT REQUEST =====
    socket.on('accept-request', ({ fromPin, toPin }) => {
        let requestId = null;
        let request = null;
        for (const [key, req] of pendingStore) {
            if (req.fromPin === fromPin && req.toPin === toPin) {
                requestId = key;
                request = req;
                break;
            }
        }

        if (!request) {
            return socket.emit('error', 'Request not found');
        }

        pendingStore.delete(requestId);

        const chatId = `chat_${Date.now()}`;
        chatStore.set(chatId, {
            participants: [fromPin, toPin],
            messages: [],
            createdAt: Date.now()
        });

        let fromUser = null;
        let fromPhone = null;
        let toUser = null;
        let toPhone = null;

        for (const [phone, user] of userStore) {
            if (user.pin === fromPin) { fromUser = user; fromPhone = phone; }
            if (user.pin === toPin) { toUser = user; toPhone = phone; }
        }

        if (fromUser) {
            if (!fromUser.chats) fromUser.chats = [];
            fromUser.chats.push({
                pin: toPin,
                name: toUser ? toUser.name : 'User',
                chatId: chatId,
                phone: toPhone ? formatPhoneNumber(toPhone) : ''
            });
            userStore.set(fromPhone, fromUser);
        }

        if (toUser) {
            if (!toUser.chats) toUser.chats = [];
            toUser.chats.push({
                pin: fromPin,
                name: fromUser ? fromUser.name : 'User',
                chatId: chatId,
                phone: fromPhone ? formatPhoneNumber(fromPhone) : ''
            });
            userStore.set(toPhone, toUser);
        }

        if (fromUser && fromUser.socketId) {
            io.to(`user_${fromPin}`).emit('request-accepted', {
                withPin: toPin,
                withName: toUser ? toUser.name : 'User',
                chatId
            });
        }
        if (toUser && toUser.socketId) {
            io.to(`user_${toPin}`).emit('request-accepted', {
                withPin: fromPin,
                withName: fromUser ? fromUser.name : 'User',
                chatId
            });
        }

        console.log(`✅ Chat created between ${fromPin} and ${toPin}`);
    });

    // ===== DECLINE REQUEST =====
    socket.on('decline-request', ({ fromPin, toPin }) => {
        let requestId = null;
        for (const [key, req] of pendingStore) {
            if (req.fromPin === fromPin && req.toPin === toPin) {
                requestId = key;
                break;
            }
        }

        if (!requestId) {
            return socket.emit('error', 'Request not found');
        }

        pendingStore.delete(requestId);

        let fromUser = null;
        for (const [phone, user] of userStore) {
            if (user.pin === fromPin) { fromUser = user; break; }
        }
        if (fromUser && fromUser.socketId) {
            io.to(`user_${fromPin}`).emit('request-declined', {
                byPin: toPin,
                byName: 'User'
            });
        }

        socket.emit('request-declined-success');
    });

    // ===== CANCEL REQUEST =====
    socket.on('cancel-request', ({ fromPin, toPin }) => {
        let requestId = null;
        for (const [key, req] of pendingStore) {
            if (req.fromPin === fromPin && req.toPin === toPin) {
                requestId = key;
                break;
            }
        }

        if (requestId) {
            pendingStore.delete(requestId);
            let toUser = null;
            for (const [phone, user] of userStore) {
                if (user.pin === toPin) { toUser = user; break; }
            }
            if (toUser && toUser.socketId) {
                io.to(`user_${toPin}`).emit('request-cancelled', { fromPin });
            }
            socket.emit('request-cancelled-success');
        }
    });

    // ===== TEXT MESSAGE =====
    socket.on('chat-message', ({ chatId, text, messageId, fromPin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) {
            return socket.emit('error', 'Chat not found');
        }

        const messageData = {
            id: messageId || `${Date.now()}_${fromPin}`,
            text,
            from: fromPin,
            timestamp: Date.now(),
            type: 'text',
            deleted: false
        };

        chat.messages.push(messageData);
        chatStore.set(chatId, chat);

        chat.participants.forEach(participant => {
            io.to(`user_${participant}`).emit('chat-message', {
                ...messageData,
                chatId
            });
        });
    });

    // ===== IMAGE MESSAGE =====
    socket.on('chat-image', ({ chatId, image, fileName, messageId, fromPin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) return;

        const messageData = {
            id: messageId || `${Date.now()}_img`,
            image,
            fileName,
            from: fromPin,
            timestamp: Date.now(),
            type: 'image',
            deleted: false
        };

        chat.messages.push(messageData);
        chatStore.set(chatId, chat);

        chat.participants.forEach(participant => {
            io.to(`user_${participant}`).emit('chat-image', {
                ...messageData,
                chatId
            });
        });
    });

    // ===== FILE MESSAGE =====
    socket.on('chat-file', ({ chatId, fileData, fileName, fileSize, messageId, fromPin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) return;

        const messageData = {
            id: messageId || `${Date.now()}_file`,
            fileData,
            fileName,
            fileSize,
            from: fromPin,
            timestamp: Date.now(),
            type: 'file',
            deleted: false
        };

        chat.messages.push(messageData);
        chatStore.set(chatId, chat);

        chat.participants.forEach(participant => {
            io.to(`user_${participant}`).emit('chat-file', {
                ...messageData,
                chatId
            });
        });
    });

    // ===== VOICE MESSAGE (FIXED) =====
    socket.on('voice-message', ({ chatId, audioData, duration, messageId, fromPin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) {
            console.log('❌ Chat not found:', chatId);
            return;
        }

        console.log('🎤 Voice message received from:', fromPin, 'duration:', duration);
        console.log('📊 Audio data size:', audioData ? audioData.length : 'null');

        const messageData = {
            id: messageId || `${Date.now()}_voice`,
            audioData: audioData,
            duration: duration || 0,
            from: fromPin,
            timestamp: Date.now(),
            type: 'voice',
            deleted: false
        };

        chat.messages.push(messageData);
        chatStore.set(chatId, chat);

        chat.participants.forEach(participant => {
            console.log(`📤 Sending voice to participant: ${participant}`);
            io.to(`user_${participant}`).emit('voice-message', {
                ...messageData,
                chatId
            });
        });
    });

    // ===== DELETE CHAT =====
    socket.on('delete-chat', ({ chatId, pin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) {
            return socket.emit('error', 'Chat not found');
        }

        let userPhone = null;
        let user = null;
        for (const [phone, u] of userStore) {
            if (u.pin === pin) {
                userPhone = phone;
                user = u;
                break;
            }
        }

        if (user) {
            user.chats = user.chats.filter(c => c.chatId !== chatId);
            userStore.set(userPhone, user);
        }

        chat.participants = chat.participants.filter(p => p !== pin);

        if (chat.participants.length === 0) {
            chatStore.delete(chatId);
            console.log(`🗑️ Chat ${chatId} completely deleted`);
        } else {
            chat.messages = [];
            chatStore.set(chatId, chat);
            console.log(`🗑️ User ${pin} deleted chat ${chatId}`);
        }

        socket.emit('chat-deleted', { chatId });

        chat.participants.forEach(participant => {
            io.to(`user_${participant}`).emit('partner-left-chat', { chatId });
        });
    });

    // ===== GET CHAT HISTORY =====
    socket.on('get-chat-history', ({ chatId }) => {
        const chat = chatStore.get(chatId);
        if (!chat) {
            return socket.emit('error', 'Chat not found');
        }
        socket.emit('chat-history', { chatId, messages: chat.messages });
    });

    // ===== TYPING INDICATOR =====
    socket.on('typing', ({ chatId, isTyping, fromPin }) => {
        const chat = chatStore.get(chatId);
        if (!chat) return;
        chat.participants.forEach(participant => {
            if (participant !== fromPin) {
                io.to(`user_${participant}`).emit('user-typing', { chatId, isTyping });
            }
        });
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        for (const [phone, user] of userStore) {
            if (user.socketId === socket.id) {
                user.socketId = null;
                userStore.set(phone, user);
                break;
            }
        }
    });
});

// ===== CLEAN UP EXPIRED REQUESTS (24 HOURS) =====
setInterval(() => {
    const now = Date.now();
    const toDelete = [];
    for (const [key, req] of pendingStore) {
        if (now - req.timestamp > 86400000) {
            toDelete.push(key);
        }
    }
    toDelete.forEach(key => {
        const req = pendingStore.get(key);
        pendingStore.delete(key);
        if (req) {
            io.to(`user_${req.toPin}`).emit('request-expired', { fromPin: req.fromPin });
            io.to(`user_${req.fromPin}`).emit('request-expired', { toPin: req.toPin });
        }
    });
    if (toDelete.length > 0) {
        console.log(`🧹 Cleaned up ${toDelete.length} expired requests`);
    }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ Quickie is running on port ${PORT}`);
});