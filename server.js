const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ===== Database Connection =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===== In-memory stores (for real-time operations) =====
const otpStore = new Map();
const roomStore = new Map();
const reactionStore = new Map();
const activeUsers = new Map();

// ===== Database Functions =====

// Create tables if they don't exist
async function initDatabase() {
    try {
        // Chats table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        partner_id TEXT NOT NULL,
        partner_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

        // Messages table
        await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
        from_user TEXT NOT NULL,
        text TEXT,
        image_data TEXT,
        file_data TEXT,
        file_name TEXT,
        file_size TEXT,
        audio_data TEXT,
        duration INTEGER,
        type TEXT DEFAULT 'text',
        deleted BOOLEAN DEFAULT FALSE,
        timestamp BIGINT NOT NULL
      )
    `);

        console.log('✅ Database initialized successfully');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
    }
}

// Get or create chat
async function getOrCreateChat(partnerId, partnerName) {
    try {
        // Check if chat exists
        const result = await pool.query(
            'SELECT * FROM chats WHERE partner_id = $1',
            [partnerId]
        );

        if (result.rows.length > 0) {
            return result.rows[0];
        }

        // Create new chat
        const chatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        await pool.query(
            'INSERT INTO chats (id, partner_id, partner_name) VALUES ($1, $2, $3)',
            [chatId, partnerId, partnerName]
        );

        return { id: chatId, partner_id: partnerId, partner_name: partnerName };
    } catch (err) {
        console.error('Error getting/creating chat:', err);
        return null;
    }
}

// Save message to database
async function saveMessage(chatId, fromUser, messageData) {
    try {
        const query = `
      INSERT INTO messages 
      (id, chat_id, from_user, text, image_data, file_data, file_name, file_size, audio_data, duration, type, deleted, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

        const values = [
            messageData.id,
            chatId,
            fromUser,
            messageData.text || null,
            messageData.image || null,
            messageData.fileData || null,
            messageData.fileName || null,
            messageData.fileSize || null,
            messageData.audioData || null,
            messageData.duration || null,
            messageData.type || 'text',
            messageData.deleted || false,
            messageData.timestamp || Date.now()
        ];

        await pool.query(query, values);

        // Update chat updated_at
        await pool.query(
            'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [chatId]
        );

        return true;
    } catch (err) {
        console.error('Error saving message:', err);
        return false;
    }
}

// Get chat history
async function getChatHistory(chatId) {
    try {
        const result = await pool.query(
            'SELECT * FROM messages WHERE chat_id = $1 AND deleted = false ORDER BY timestamp ASC',
            [chatId]
        );
        return result.rows;
    } catch (err) {
        console.error('Error getting chat history:', err);
        return [];
    }
}

// Get all chats for a user
async function getUserChats(userId) {
    try {
        const result = await pool.query(
            'SELECT * FROM chats ORDER BY updated_at DESC'
        );
        return result.rows;
    } catch (err) {
        console.error('Error getting user chats:', err);
        return [];
    }
}

// Delete a message (soft delete)
async function deleteMessageFromDB(messageId) {
    try {
        await pool.query(
            'UPDATE messages SET deleted = true WHERE id = $1',
            [messageId]
        );
        return true;
    } catch (err) {
        console.error('Error deleting message:', err);
        return false;
    }
}

// ===== API Routes =====

app.get('/create', (req, res) => {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const socketId = req.query.socketId;
    if (!socketId) {
        return res.status(400).json({ error: 'socketId required' });
    }
    otpStore.set(otp, { socketId, expiresAt: Date.now() + 120000 });
    res.json({ otp });
});

// Get user's chats
app.get('/api/chats', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: 'userId required' });
    }

    try {
        const chats = await getUserChats(userId);
        res.json({ chats });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get chats' });
    }
});

// Get chat history
app.get('/api/chat/:chatId', async (req, res) => {
    const { chatId } = req.params;

    try {
        const messages = await getChatHistory(chatId);
        res.json({ messages });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// ===== Socket.IO =====

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    activeUsers.set(socket.id, { roomId: null, status: 'online', lastSeen: Date.now() });

    socket.on('join-with-otp', async (otp) => {
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

        // Get or create chat in database
        const partnerName = 'Partner'; // Will be replaced with actual name
        const chat = await getOrCreateChat(socket.id, partnerName);

        // Get chat history
        const history = chat ? await getChatHistory(chat.id) : [];

        activeUsers.set(socket.id, { roomId, status: 'online', lastSeen: Date.now() });
        if (creatorSocket) {
            activeUsers.set(creatorSocketId, { roomId, status: 'online', lastSeen: Date.now() });
        }

        // Send chat data to both users
        io.to(roomId).emit('chat-history', {
            chatId: chat ? chat.id : null,
            messages: history,
            partnerId: socket.id
        });

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

    socket.on('chat-message', async ({ roomId, text, messageId, replyTo }) => {
        const messageData = {
            id: messageId,
            text,
            from: socket.id,
            timestamp: Date.now(),
            type: 'text',
            deleted: false,
            replyTo: replyTo || null
        };

        // Find chat for this room
        const room = roomStore.get(roomId);
        if (room) {
            // Save to database
            const chatId = `chat_${roomId}`;
            await saveMessage(chatId, socket.id, messageData);
        }

        io.to(roomId).emit('chat-message', messageData);
    });

    socket.on('chat-image', async ({ roomId, image, fileName, messageId }) => {
        const messageData = {
            id: messageId || Date.now() + '_img',
            image,
            fileName,
            from: socket.id,
            timestamp: Date.now(),
            type: 'image',
            deleted: false
        };

        const room = roomStore.get(roomId);
        if (room) {
            const chatId = `chat_${roomId}`;
            await saveMessage(chatId, socket.id, messageData);
        }

        io.to(roomId).emit('chat-image', messageData);
    });

    socket.on('chat-file', async ({ roomId, fileData, fileName, fileType, fileSize, messageId }) => {
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

        const room = roomStore.get(roomId);
        if (room) {
            const chatId = `chat_${roomId}`;
            await saveMessage(chatId, socket.id, messageData);
        }

        io.to(roomId).emit('chat-file', messageData);
    });

    socket.on('voice-message', async ({ roomId, audioData, duration, messageId }) => {
        const messageData = {
            id: messageId || Date.now() + '_voice',
            audioData,
            duration,
            from: socket.id,
            timestamp: Date.now(),
            type: 'voice',
            deleted: false
        };

        const room = roomStore.get(roomId);
        if (room) {
            const chatId = `chat_${roomId}`;
            await saveMessage(chatId, socket.id, messageData);
        }

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

    socket.on('delete-message', async ({ roomId, messageId }) => {
        await deleteMessageFromDB(messageId);
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

    socket.on('rejoin-room', async (roomId) => {
        const room = roomStore.get(roomId);
        if (room) {
            socket.join(roomId);

            if (!room.includes(socket.id)) {
                room.push(socket.id);
                roomStore.set(roomId, room);
            }

            // Load history from database
            const chatId = `chat_${roomId}`;
            const history = await getChatHistory(chatId);
            socket.emit('chat-history', {
                chatId: chatId,
                messages: history,
                partnerId: room.find(id => id !== socket.id) || null
            });

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

            console.log('User rejoined room:', roomId);
        } else {
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

// ===== Initialize Database and Start Server =====
const port = process.env.PORT || 3000;

initDatabase().then(() => {
    server.listen(port, () => {
        console.log(`✅ Quickie is running on port ${port}`);
    });
}).catch(err => {
    console.error('❌ Failed to start server:', err);
});