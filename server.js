const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// In-memory stores
const otpStore = new Map();
const roomStore = new Map();
const messageHistory = new Map();
const reactionStore = new Map();
const activeUsers = new Map();

// Clean up old messages every hour (keep 24 hours)
setInterval(() => {
    const now = Date.now();
    for (const [roomId, messages] of messageHistory) {
        const filtered = messages.filter(msg => (now - msg.timestamp) < 86400000);
        if (filtered.length === 0) {
            messageHistory.delete(roomId);
        } else {
            messageHistory.set(roomId, filtered);
        }
    }
}, 3600000);

// Clean up inactive users every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [socketId, data] of activeUsers) {
        if (now - data.lastSeen > 300000) {
            activeUsers.delete(socketId);
        }
    }
}, 300000);

app.get('/create', (req, res) => {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const socketId = req.query.socketId;
    if (!socketId) {
        return res.status(400).json({ error: 'socketId required' });
    }
    otpStore.set(otp, { socketId, expiresAt: Date.now() + 120000 });
    res.json({ otp });
});

// ===== Silent Sync Endpoint =====
app.get('/sync', (req, res) => {
    const roomId = req.query.roomId;
    const since = parseInt(req.query.since) || 0;

    if (!roomId) {
        return res.status(400).json({ error: 'roomId required' });
    }

    const messages = messageHistory.get(roomId) || [];
    const newMessages = messages.filter(msg => msg.timestamp > since && !msg.deleted);

    let latestTimestamp = since;
    if (messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        latestTimestamp = lastMsg.timestamp > since ? lastMsg.timestamp : since;
    }

    res.json({
        messages: newMessages,
        latestTimestamp: latestTimestamp
    });
});

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    activeUsers.set(socket.id, { roomId: null, status: 'online', lastSeen: Date.now() });

    socket.on('join-with-otp', (otp) => {
        const entry = otpStore.get(otp);
        if (!entry) {
            return socket.emit('error', 'Invalid OTP');
        }
        if (Date.now() > entry.expiresAt) {
            otpStore.delete(otp);
            return socket.emit('error', 'OTP expired');
        }

        const creatorSocketId = entry.socketId;
        if (creatorSocketId === socket.id) {
            return socket.emit('error', 'Cannot join your own chat');
        }

        const roomId = `room_${otp}`;
        roomStore.set(roomId, [creatorSocketId, socket.id]);

        socket.join(roomId);
        const creatorSocket = io.sockets.sockets.get(creatorSocketId);
        if (creatorSocket) {
            creatorSocket.join(roomId);
        }

        activeUsers.set(socket.id, { roomId, status: 'online', lastSeen: Date.now() });
        if (creatorSocket) {
            activeUsers.set(creatorSocketId, { roomId, status: 'online', lastSeen: Date.now() });
        }

        const history = messageHistory.get(roomId) || [];
        io.to(roomId).emit('chat-history', history);

        io.to(roomId).emit('user-status', {
            userId: socket.id,
            status: 'online'
        });
        io.to(roomId).emit('user-status', {
            userId: creatorSocketId,
            status: 'online'
        });

        io.to(roomId).emit('paired', { roomId });
        otpStore.delete(otp);
    });

    socket.on('chat-message', ({ roomId, text, messageId, replyTo }) => {
        const messageData = {
            id: messageId,
            text,
            from: socket.id,
            timestamp: Date.now(),
            type: 'text',
            deleted: false,
            replyTo: replyTo || null
        };

        if (!messageHistory.has(roomId)) {
            messageHistory.set(roomId, []);
        }
        messageHistory.get(roomId).push(messageData);

        io.to(roomId).emit('chat-message', messageData);
    });

    socket.on('chat-image', ({ roomId, image, fileName, messageId }) => {
        const messageData = {
            id: messageId || Date.now() + '_img',
            image,
            fileName,
            from: socket.id,
            timestamp: Date.now(),
            type: 'image',
            deleted: false
        };

        if (!messageHistory.has(roomId)) {
            messageHistory.set(roomId, []);
        }
        messageHistory.get(roomId).push(messageData);

        io.to(roomId).emit('chat-image', messageData);
    });

    socket.on('chat-file', ({ roomId, fileData, fileName, fileType, fileSize, messageId }) => {
        const messageData = {
            id: messageId || Date.now() + '_file',
            fileData,
            fileName,
            fileType,
            fileSize,
            from: socket.id,
            timestamp: Date.now(),
            type: 'file',
            deleted: false
        };

        if (!messageHistory.has(roomId)) {
            messageHistory.set(roomId, []);
        }
        messageHistory.get(roomId).push(messageData);

        io.to(roomId).emit('chat-file', messageData);
    });

    socket.on('voice-message', ({ roomId, audioData, duration, messageId }) => {
        const messageData = {
            id: messageId || Date.now() + '_voice',
            audioData,
            duration,
            from: socket.id,
            timestamp: Date.now(),
            type: 'voice',
            deleted: false
        };

        if (!messageHistory.has(roomId)) {
            messageHistory.set(roomId, []);
        }
        messageHistory.get(roomId).push(messageData);

        io.to(roomId).emit('voice-message', messageData);
    });

    socket.on('message-reaction', ({ messageId, roomId, reaction, remove }) => {
        if (!reactionStore.has(messageId)) {
            reactionStore.set(messageId, {});
        }
        const reactions = reactionStore.get(messageId);

        if (remove) {
            delete reactions[socket.id];
        } else {
            reactions[socket.id] = reaction;
        }

        if (Object.keys(reactions).length === 0) {
            reactionStore.delete(messageId);
        }

        io.to(roomId).emit('reaction-update', {
            messageId,
            reactions: reactionStore.get(messageId) || {}
        });
    });

    socket.on('delete-message', ({ roomId, messageId }) => {
        if (messageHistory.has(roomId)) {
            const messages = messageHistory.get(roomId);
            const msg = messages.find(m => m.id === messageId);
            if (msg) {
                msg.deleted = true;
                msg.text = 'This message was deleted';
                if (msg.type === 'image') {
                    msg.image = null;
                }
                if (msg.type === 'voice') {
                    msg.audioData = null;
                }
                if (msg.type === 'file') {
                    msg.fileData = null;
                }
            }
            messageHistory.set(roomId, messages);
        }

        io.to(roomId).emit('message-deleted', { messageId });
    });

    socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('user-typing', { isTyping });
    });

    socket.on('status-update', ({ roomId, status }) => {
        const userData = activeUsers.get(socket.id);
        if (userData) {
            userData.status = status;
            userData.lastSeen = Date.now();
            activeUsers.set(socket.id, userData);
        }
        if (roomId) {
            socket.to(roomId).emit('user-status', {
                userId: socket.id,
                status: status,
                lastSeen: Date.now()
            });
        }
    });

    // ===== FIXED: Rejoin Room - Allows new socket to join existing room =====
    socket.on('rejoin-room', (roomId) => {
        // Check if the room exists
        const room = roomStore.get(roomId);
        if (room) {
            // Add the socket to the room
            socket.join(roomId);

            // Update room store - add new socket if not already there
            if (!room.includes(socket.id)) {
                room.push(socket.id);
                roomStore.set(roomId, room);
            }

            // Send history
            const history = messageHistory.get(roomId) || [];
            socket.emit('chat-history', history);

            // Silent rejoin - no visible notification
            socket.emit('rejoin-success', { roomId });

            const userData = activeUsers.get(socket.id);
            if (userData) {
                userData.roomId = roomId;
                userData.status = 'online';
                userData.lastSeen = Date.now();
                activeUsers.set(socket.id, userData);
            }

            socket.to(roomId).emit('user-status', {
                userId: socket.id,
                status: 'online'
            });

            console.log('User rejoined room:', roomId, 'New socket:', socket.id);
        } else {
            console.log('Room not found for rejoin:', roomId);
            // Room doesn't exist - notify client
            socket.emit('rejoin-failed', { roomId });
        }
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
        socket.to(roomId).emit('partner-left');

        const userData = activeUsers.get(socket.id);
        if (userData) {
            userData.roomId = null;
            userData.status = 'offline';
            userData.lastSeen = Date.now();
            activeUsers.set(socket.id, userData);
        }
        socket.to(roomId).emit('user-status', {
            userId: socket.id,
            status: 'offline'
        });

        const room = roomStore.get(roomId);
        if (room) {
            const remaining = room.filter(id => id !== socket.id);
            if (remaining.length === 0) {
                roomStore.delete(roomId);
                console.log('Room deleted:', roomId);
            } else {
                roomStore.set(roomId, remaining);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        const userData = activeUsers.get(socket.id);
        if (userData && userData.roomId) {
            socket.to(userData.roomId).emit('user-status', {
                userId: socket.id,
                status: 'offline'
            });
        }

        setTimeout(() => {
            if (!socket.connected) {
                for (const [roomId, members] of roomStore) {
                    if (members.includes(socket.id)) {
                        const remaining = members.filter(id => id !== socket.id);
                        if (remaining.length === 0) {
                            roomStore.delete(roomId);
                        } else {
                            roomStore.set(roomId, remaining);
                            socket.to(roomId).emit('partner-left');
                            socket.to(roomId).emit('user-status', {
                                userId: socket.id,
                                status: 'offline'
                            });
                        }
                    }
                }
                activeUsers.delete(socket.id);
            }
        }, 5000);
    });
});

server.listen(3000, () => {
    console.log('✅ Quickie is running on http://localhost:3000');
});