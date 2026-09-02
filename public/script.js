(function () {
    // ===== DOM References =====
    const pairingScreen = document.getElementById('pairingScreen');
    const chatScreen = document.getElementById('chatScreen');
    const otpDisplay = document.getElementById('otpDisplay');
    const createBtn = document.getElementById('createBtn');
    const joinBtn = document.getElementById('joinBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const otpInput = document.getElementById('otpInput');
    const errorMsg = document.getElementById('errorMsg');
    const messageList = document.getElementById('messageList');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const chatList = document.getElementById('chatList');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const partnerName = document.getElementById('partnerName');

    // ===== State =====
    let socket = null;
    let currentRoomId = null;
    let currentChatId = null;
    let mySocketId = null;
    let typingTimeout = null;
    let isTyping = false;
    let timerInterval = null;
    let timerSeconds = 120;
    let messageIdCounter = 0;
    let replyToMessage = null;
    let partnerStatus = 'offline';
    let allMessages = [];
    let allChats = [];
    let isFirstHistoryLoad = true;
    let activeChatId = null;

    // ===== Silent Sync State =====
    let lastSyncTime = 0;
    let syncInterval = null;

    // ===== Voice Recording State =====
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingTimer = null;
    let recordingSeconds = 0;
    let isRecording = false;

    // ===== Scroll Helper =====
    function scrollToBottom() {
        if (messageList) {
            messageList.scrollTop = messageList.scrollHeight;
        }
    }

    // ===== Save/Restore Room =====
    function saveRoomId(roomId) {
        if (roomId) {
            sessionStorage.setItem('quickie_roomId', roomId);
        } else {
            sessionStorage.removeItem('quickie_roomId');
        }
    }

    function getSavedRoomId() {
        return sessionStorage.getItem('quickie_roomId');
    }

    // ===== Chat Management =====
    function addChat(chatId, partnerId, partnerName) {
        // Check if chat already exists
        const exists = allChats.some(c => c.id === chatId);
        if (!exists) {
            allChats.push({
                id: chatId,
                partnerId: partnerId,
                partnerName: partnerName || 'Partner',
                lastMessage: null,
                lastTimestamp: null,
                unreadCount: 0,
                isActive: false,
                messages: []
            });
            renderChatList();
            saveChatsToLocal();
        }
    }

    function getChat(chatId) {
        return allChats.find(c => c.id === chatId);
    }

    function updateChatLastMessage(chatId, message, timestamp) {
        const chat = getChat(chatId);
        if (chat) {
            chat.lastMessage = message;
            chat.lastTimestamp = timestamp || Date.now();
            chat.isActive = (chat.id === activeChatId);
            renderChatList();
            saveChatsToLocal();
        }
    }

    function setActiveChat(chatId) {
        activeChatId = chatId;
        allChats.forEach(c => {
            c.isActive = (c.id === chatId);
            if (c.id === chatId) {
                c.unreadCount = 0;
            }
        });
        renderChatList();
        saveChatsToLocal();
    }

    function loadChatMessages(chatId) {
        const chat = getChat(chatId);
        if (chat) {
            messageList.innerHTML = '';
            allMessages = chat.messages || [];
            allMessages.forEach(msg => {
                if (msg.deleted) {
                    appendMessage('This message was deleted', msg.from === mySocketId ? 'me' : 'other', msg.id, msg.timestamp);
                    return;
                }
                if (msg.type === 'text') {
                    appendMessage(msg.text, msg.from === mySocketId ? 'me' : 'other', msg.id, msg.timestamp, msg.replyTo);
                } else if (msg.type === 'image') {
                    appendImage(msg.image, msg.from === mySocketId ? 'me' : 'other', msg.id, msg.timestamp);
                } else if (msg.type === 'voice') {
                    appendVoiceMessage(msg.audioData, msg.duration, msg.from === mySocketId ? 'me' : 'other', msg.id, msg.timestamp);
                } else if (msg.type === 'file') {
                    appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, msg.from === mySocketId ? 'me' : 'other', msg.id, msg.timestamp);
                }
            });
            partnerName.textContent = chat.partnerName || 'Partner';
            scrollToBottom();
        }
    }

    function addMessageToChat(chatId, messageData) {
        const chat = getChat(chatId);
        if (chat) {
            chat.messages.push(messageData);
            chat.lastMessage = messageData.text || (messageData.type === 'image' ? '📸 Image' : messageData.type === 'file' ? '📄 File' : messageData.type === 'voice' ? '🎤 Voice' : '');
            chat.lastTimestamp = messageData.timestamp || Date.now();

            if (chat.id !== activeChatId && messageData.from !== mySocketId) {
                chat.unreadCount = (chat.unreadCount || 0) + 1;
            }

            if (chat.id === activeChatId) {
                allMessages.push(messageData);
                displayMessage(messageData);
            }

            renderChatList();
            saveChatsToLocal();
        }
    }

    function displayMessage(messageData) {
        if (messageData.deleted) {
            appendMessage('This message was deleted', messageData.from === mySocketId ? 'me' : 'other', messageData.id, messageData.timestamp);
            return;
        }
        if (messageData.type === 'text') {
            appendMessage(messageData.text, messageData.from === mySocketId ? 'me' : 'other', messageData.id, messageData.timestamp, messageData.replyTo);
        } else if (messageData.type === 'image') {
            appendImage(messageData.image, messageData.from === mySocketId ? 'me' : 'other', messageData.id, messageData.timestamp);
        } else if (messageData.type === 'voice') {
            appendVoiceMessage(messageData.audioData, messageData.duration, messageData.from === mySocketId ? 'me' : 'other', messageData.id, messageData.timestamp);
        } else if (messageData.type === 'file') {
            appendFileMessage(messageData.fileData, messageData.fileName, messageData.fileSize, messageData.from === mySocketId ? 'me' : 'other', messageData.id, messageData.timestamp);
        }
    }

    function saveChatsToLocal() {
        try {
            localStorage.setItem('quickie_chats', JSON.stringify(allChats));
        } catch (e) {
            console.log('Failed to save chats to localStorage');
        }
    }

    function loadChatsFromLocal() {
        try {
            const saved = localStorage.getItem('quickie_chats');
            if (saved) {
                allChats = JSON.parse(saved);
                // Find active chat
                const active = allChats.find(c => c.isActive);
                if (active) {
                    activeChatId = active.id;
                    partnerName.textContent = active.partnerName || 'Partner';
                    loadChatMessages(activeChatId);
                }
                renderChatList();
            }
        } catch (e) {
            console.log('Failed to load chats from localStorage');
        }
    }

    // ===== Render Chat List =====
    function renderChatList() {
        chatList.innerHTML = '';
        const sortedChats = [...allChats].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

        if (sortedChats.length === 0) {
            chatList.innerHTML = `
        <div style="padding: 2rem 1rem; text-align: center; color: #6b7280; font-size: 0.9rem;">
          No chats yet.<br/>Start a new chat!
        </div>
      `;
            return;
        }

        sortedChats.forEach(chat => {
            const item = document.createElement('div');
            item.className = `chat-item${chat.isActive ? ' active' : ''}`;

            const avatar = document.createElement('div');
            avatar.className = 'chat-item-avatar';
            avatar.textContent = (chat.partnerName || 'P').charAt(0).toUpperCase();
            avatar.style.background = getColorFromString(chat.partnerId || chat.id);

            const info = document.createElement('div');
            info.className = 'chat-item-info';

            const nameRow = document.createElement('div');
            nameRow.style.display = 'flex';
            nameRow.style.alignItems = 'center';

            const name = document.createElement('span');
            name.className = 'chat-item-name';
            name.textContent = chat.partnerName || 'Partner';

            const statusDot = document.createElement('span');
            statusDot.className = 'chat-item-status offline';

            nameRow.appendChild(name);
            nameRow.appendChild(statusDot);

            const preview = document.createElement('div');
            preview.className = 'chat-item-preview';
            preview.textContent = chat.lastMessage || 'Start chatting...';

            const time = document.createElement('span');
            time.className = 'chat-item-time';
            if (chat.lastTimestamp) {
                time.textContent = formatTime(chat.lastTimestamp);
            }

            const badge = document.createElement('span');
            badge.className = 'chat-item-badge';
            badge.textContent = chat.unreadCount || 0;
            if (!chat.unreadCount || chat.unreadCount === 0) {
                badge.style.display = 'none';
            }

            info.appendChild(nameRow);
            info.appendChild(preview);

            const right = document.createElement('div');
            right.style.display = 'flex';
            right.style.alignItems = 'center';
            right.style.marginLeft = 'auto';
            right.appendChild(time);
            right.appendChild(badge);

            item.appendChild(avatar);
            item.appendChild(info);
            item.appendChild(right);

            item.addEventListener('click', () => {
                switchChat(chat.id);
                // Close sidebar on mobile
                closeSidebar();
            });

            chatList.appendChild(item);
        });
    }

    function getColorFromString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const colors = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#16a34a'];
        return colors[Math.abs(hash) % colors.length];
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (msgDate.getTime() === today.getTime()) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    }

    // ===== Switch Chat =====
    function switchChat(chatId) {
        if (activeChatId === chatId) return;

        // Save current chat messages
        const currentChat = getChat(activeChatId);
        if (currentChat) {
            currentChat.messages = allMessages;
            currentChat.isActive = false;
        }

        setActiveChat(chatId);
        loadChatMessages(chatId);

        // Update partner status
        const chat = getChat(chatId);
        if (chat) {
            partnerName.textContent = chat.partnerName || 'Partner';
            // Request partner status
            if (socket && currentRoomId) {
                socket.emit('status-update', { roomId: currentRoomId, status: 'online' });
            }
        }
    }

    // ===== Sidebar Controls =====
    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('show');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('show');
    }

    function toggleSidebar() {
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    }

    // ===== Socket Connection =====
    function connectSocket() {
        socket = io({
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });

        socket.on('connect', () => {
            mySocketId = socket.id;
            errorMsg.textContent = '';
            console.log('🔗 Connected to Quickie');

            const savedRoom = getSavedRoomId();
            if (savedRoom && !currentRoomId) {
                console.log('🔄 Auto-rejoining saved room:', savedRoom);
                socket.emit('rejoin-room', savedRoom);
            } else if (currentRoomId) {
                socket.emit('rejoin-room', currentRoomId);
            }
        });

        socket.on('connect_error', () => {
            errorMsg.textContent = '⚠️ Cannot reach server. Make sure server is running.';
        });

        socket.on('reconnecting', (attemptNumber) => {
            console.log('🔄 Reconnecting... (attempt ' + attemptNumber + ')');
        });

        socket.on('reconnect_failed', () => {
            appendMessage('❌ Failed to reconnect. Please refresh the page.', 'system');
        });
    }
    connectSocket();

    // ===== Sound Notifications =====
    function playNotificationSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;

            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
            }, 150);
        } catch (e) {
            console.log('Sound not supported');
        }
    }

    // ===== Push Notifications =====
    function sendPushNotification(title, body) {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            new Notification(title, {
                body: body,
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%234f46e5" rx="20"/%3E%3Ctext x="50" y="68" font-size="50" text-anchor="middle" fill="white"%3E💬%3C/text%3E%3C/svg%3E',
                tag: 'quickie-notification',
                requireInteraction: true,
                vibrate: [200, 100, 200]
            });
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    sendPushNotification(title, body);
                }
            });
        }
    }

    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // ===== Helper Functions =====
    function setError(msg) {
        errorMsg.textContent = msg;
        if (msg) setTimeout(() => { errorMsg.textContent = ''; }, 5000);
    }

    function goToMainMenu() {
        if (socket && currentRoomId) {
            socket.emit('leave-room', currentRoomId);
        }
        currentRoomId = null;
        currentChatId = null;
        activeChatId = null;
        saveRoomId(null);
        chatScreen.classList.remove('active');
        pairingScreen.style.display = 'flex';
        otpDisplay.classList.remove('show');
        messageList.innerHTML = '';
        chatInput.value = '';
        otpInput.value = '';
        otpInput.focus();
        document.getElementById('typingIndicator').style.display = 'none';
        document.getElementById('quickReplies').classList.remove('show');
        document.getElementById('searchBar').classList.remove('show');
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        replyToMessage = null;
        updateReplyPreview();
        updateStatus('offline');
        allMessages = [];
        isFirstHistoryLoad = true;
        lastSyncTime = 0;
        chatList.innerHTML = '';
        partnerName.textContent = 'Select a chat';
    }

    function enterChat(roomId, chatId) {
        currentRoomId = roomId;
        currentChatId = chatId;
        saveRoomId(roomId);
        pairingScreen.style.display = 'none';
        chatScreen.classList.add('active');
        chatInput.focus();
        isFirstHistoryLoad = true;
        lastSyncTime = Date.now();

        // Load chats from localStorage
        loadChatsFromLocal();

        // If we have a chat ID, set it as active
        if (chatId) {
            setActiveChat(chatId);
            loadChatMessages(chatId);
            const chat = getChat(chatId);
            if (chat) {
                partnerName.textContent = chat.partnerName || 'Partner';
            }
        }

        document.getElementById('quickReplies').classList.add('show');
        startSilentSync();
    }

    function createMessageWrapper(messageId) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        wrapper.dataset.messageId = messageId;
        return wrapper;
    }

    function updateStatus(status) {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');

        dot.className = 'status-dot';
        if (status === 'online') {
            dot.classList.add('online');
            text.textContent = 'Online';
        } else if (status === 'away') {
            dot.classList.add('away');
            text.textContent = 'Away';
        } else {
            dot.classList.add('offline');
            text.textContent = 'Offline';
        }
        partnerStatus = status;
    }

    function updateReplyPreview() {
        let preview = document.querySelector('.reply-preview');
        if (!preview) {
            preview = document.createElement('div');
            preview.className = 'reply-preview';
            preview.id = 'replyPreview';
            document.querySelector('.chat-messages').appendChild(preview);
        }

        if (replyToMessage) {
            preview.classList.add('show');
            const sender = replyToMessage.from === mySocketId ? 'You' : 'Partner';
            preview.innerHTML = `
        <span class="reply-sender">${sender}:</span>
        <span class="reply-text">${replyToMessage.text.substring(0, 60)}${replyToMessage.text.length > 60 ? '...' : ''}</span>
        <button class="reply-cancel-btn" onclick="window.cancelReply()">✕</button>
      `;
        } else {
            preview.classList.remove('show');
        }
    }

    window.cancelReply = function () {
        replyToMessage = null;
        updateReplyPreview();
    };

    // ===== Silent Background Sync =====
    function startSilentSync() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }

        syncInterval = setInterval(() => {
            if (!currentRoomId || !socket || !socket.connected) return;

            fetch(`/sync?roomId=${currentRoomId}&since=${lastSyncTime}`)
                .then(res => res.json())
                .then(data => {
                    if (data.messages && data.messages.length > 0) {
                        data.messages.forEach(msg => {
                            const exists = allMessages.some(m => m.id === msg.id);
                            if (!exists && msg.from !== socket.id) {
                                // Add to current chat
                                const messageData = {
                                    id: msg.id,
                                    text: msg.text,
                                    from: msg.from,
                                    timestamp: msg.timestamp,
                                    type: msg.type || 'text',
                                    deleted: msg.deleted || false,
                                    replyTo: msg.replyTo || null,
                                    image: msg.image,
                                    fileData: msg.fileData,
                                    fileName: msg.fileName,
                                    fileSize: msg.fileSize,
                                    audioData: msg.audioData,
                                    duration: msg.duration
                                };
                                allMessages.push(messageData);
                                displayMessage(messageData);
                            }
                        });
                        lastSyncTime = data.latestTimestamp || lastSyncTime;
                    }
                })
                .catch(() => {
                    // Silent fail
                });
        }, 10000);
    }

    function appendMessageSilent(msg) {
        if (msg.type === 'text') {
            appendMessage(msg.text, 'other', msg.id, msg.timestamp, msg.replyTo);
        } else if (msg.type === 'image') {
            appendImage(msg.image, 'other', msg.id, msg.timestamp);
        } else if (msg.type === 'voice') {
            appendVoiceMessage(msg.audioData, msg.duration, 'other', msg.id, msg.timestamp);
        } else if (msg.type === 'file') {
            appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, 'other', msg.id, msg.timestamp);
        }
    }

    // ===== Refresh Chat =====
    function refreshChat() {
        if (!currentRoomId || !socket) return;
        messageList.innerHTML = '';
        allMessages = [];
        isFirstHistoryLoad = true;
        socket.emit('rejoin-room', currentRoomId);
    }

    // ===== Message Search =====
    function toggleSearch() {
        const searchBar = document.getElementById('searchBar');
        searchBar.classList.toggle('show');
        if (searchBar.classList.contains('show')) {
            document.getElementById('searchInput').focus();
        } else {
            document.getElementById('searchInput').value = '';
            document.getElementById('searchResults').classList.remove('show');
        }
    }

    function performSearch(query) {
        const resultsContainer = document.getElementById('searchResults');
        if (!query.trim()) {
            resultsContainer.classList.remove('show');
            return;
        }

        const results = allMessages.filter(msg =>
            msg.type === 'text' &&
            !msg.deleted &&
            msg.text &&
            msg.text.toLowerCase().includes(query.toLowerCase())
        );

        resultsContainer.innerHTML = '';

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="search-no-results">No messages found</div>';
            resultsContainer.classList.add('show');
            return;
        }

        results.forEach(msg => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            const highlightedText = msg.text.replace(
                new RegExp(query, 'gi'),
                match => `<span class="highlight">${match}</span>`
            );
            const sender = msg.from === mySocketId ? 'You' : 'Partner';
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            item.innerHTML = `
        <div class="result-sender">${sender} · ${time}</div>
        <div>${highlightedText}</div>
      `;
            item.addEventListener('click', () => {
                const wrapper = document.querySelector(`[data-message-id="${msg.id}"]`);
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    wrapper.style.background = 'rgba(79, 70, 229, 0.1)';
                    setTimeout(() => {
                        wrapper.style.background = '';
                    }, 2000);
                }
                document.getElementById('searchBar').classList.remove('show');
                document.getElementById('searchResults').classList.remove('show');
                document.getElementById('searchInput').value = '';
            });
            resultsContainer.appendChild(item);
        });

        resultsContainer.classList.add('show');
    }

    // ===== File Sharing =====
    function sendFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const fileData = event.target.result;
            const fileSize = (file.size / 1024).toFixed(1) + ' KB';
            if (file.size > 10 * 1024 * 1024) {
                const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
                alert(`File too large: ${sizeMB} MB. Maximum size is 10 MB.`);
                return;
            }

            const messageId = Date.now() + '_file';

            const messageData = {
                id: messageId,
                fileData: fileData,
                fileName: file.name,
                fileType: file.type,
                fileSize: fileSize,
                from: socket.id,
                timestamp: Date.now(),
                type: 'file',
                deleted: false
            };

            // Add to current chat
            allMessages.push(messageData);
            if (currentChatId) {
                addMessageToChat(currentChatId, messageData);
            }
            appendFileMessage(fileData, file.name, fileSize, 'me', messageId, Date.now());

            socket.emit('chat-file', {
                roomId: currentRoomId,
                fileData: fileData,
                fileName: file.name,
                fileType: file.type,
                fileSize: fileSize,
                messageId: messageId
            });
        };
        reader.readAsDataURL(file);
    }

    // ===== Image Sharing =====
    function sendImage(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const imageData = event.target.result;
            const messageId = Date.now() + '_img';

            const messageData = {
                id: messageId,
                image: imageData,
                fileName: file.name,
                from: socket.id,
                timestamp: Date.now(),
                type: 'image',
                deleted: false
            };

            allMessages.push(messageData);
            if (currentChatId) {
                addMessageToChat(currentChatId, messageData);
            }
            appendImage(imageData, 'me', messageId, Date.now());

            socket.emit('chat-image', {
                roomId: currentRoomId,
                image: imageData,
                fileName: file.name,
                messageId: messageId
            });
        };
        reader.readAsDataURL(file);
    }

    function appendFileMessage(fileData, fileName, fileSize, type, messageId = null, timestamp = null) {
        const wrapper = createMessageWrapper(messageId || Date.now());
        const div = document.createElement('div');

        if (type === 'me') {
            div.className = 'message me';
        } else {
            div.className = 'message other';
        }

        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = 'file-message-wrapper';

        const icon = document.createElement('span');
        icon.className = 'file-icon';
        const ext = fileName.split('.').pop().toLowerCase();
        if (['pdf'].includes(ext)) icon.textContent = '📄';
        else if (['doc', 'docx'].includes(ext)) icon.textContent = '📝';
        else if (['xls', 'xlsx'].includes(ext)) icon.textContent = '📊';
        else if (['zip', 'rar'].includes(ext)) icon.textContent = '📦';
        else if (['txt'].includes(ext)) icon.textContent = '📃';
        else icon.textContent = '📎';

        const info = document.createElement('div');
        info.className = 'file-info';
        info.innerHTML = `
      <div class="file-name">${fileName}</div>
      <div class="file-size">${fileSize}</div>
    `;

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'file-download-btn';
        downloadBtn.textContent = '⬇️';
        downloadBtn.addEventListener('click', () => {
            const link = document.createElement('a');
            link.href = fileData;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });

        wrapperDiv.appendChild(icon);
        wrapperDiv.appendChild(info);
        wrapperDiv.appendChild(downloadBtn);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        div.appendChild(wrapperDiv);
        div.appendChild(time);
        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
        return wrapper;
    }

    function appendMessage(text, type, messageId = null, timestamp = null, replyTo = null) {
        const wrapper = createMessageWrapper(messageId || Date.now());
        const div = document.createElement('div');

        if (type === 'me') {
            div.className = 'message me';
        } else if (type === 'system') {
            div.className = 'message system';
        } else {
            div.className = 'message other';
        }

        if (text === 'This message was deleted') {
            div.classList.add('deleted');
        }

        const content = document.createElement('div');

        if (replyTo) {
            const replyPreview = document.createElement('div');
            replyPreview.className = 'reply-preview show';
            const sender = replyTo.from === mySocketId ? 'You' : 'Partner';
            replyPreview.innerHTML = `
        <span class="reply-sender">${sender}:</span>
        <span class="reply-text">${replyTo.text.substring(0, 60)}${replyTo.text.length > 60 ? '...' : ''}</span>
      `;
            content.appendChild(replyPreview);
        }

        const textContent = document.createElement('div');
        textContent.textContent = text;
        content.appendChild(textContent);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        div.appendChild(content);
        div.appendChild(time);

        if ((type === 'me' || type === 'other') && text !== 'This message was deleted') {
            const actions = document.createElement('div');
            actions.className = 'message-actions';

            const replyBtn = document.createElement('button');
            replyBtn.className = 'reply-btn';
            replyBtn.textContent = '↩️';
            replyBtn.title = 'Reply';
            replyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                replyToMessage = {
                    id: wrapper.dataset.messageId,
                    text: text,
                    from: type === 'me' ? mySocketId : 'other'
                };
                updateReplyPreview();
                chatInput.focus();
            });

            actions.appendChild(replyBtn);
            div.appendChild(actions);
        }

        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
        return wrapper;
    }

    function appendImage(imageData, type, messageId = null, timestamp = null) {
        const wrapper = createMessageWrapper(messageId || Date.now());
        const div = document.createElement('div');

        if (type === 'me') {
            div.className = 'message me';
        } else {
            div.className = 'message other';
        }

        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = 'shared-image-wrapper';

        const img = document.createElement('img');
        img.src = imageData;
        img.className = 'shared-image';
        img.alt = 'Shared image';

        img.addEventListener('click', () => {
            openImageModal(imageData);
        });

        wrapperDiv.appendChild(img);

        const actions = document.createElement('div');
        actions.className = 'image-actions';

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '📥 Download';
        downloadBtn.addEventListener('click', () => {
            downloadImage(imageData, 'image.jpg');
        });

        const viewBtn = document.createElement('button');
        viewBtn.textContent = '🔍 View';
        viewBtn.addEventListener('click', () => {
            openImageModal(imageData);
        });

        actions.appendChild(downloadBtn);
        actions.appendChild(viewBtn);

        wrapperDiv.appendChild(actions);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        div.appendChild(wrapperDiv);
        div.appendChild(time);
        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
        return wrapper;
    }

    function appendVoiceMessage(audioData, duration, type, messageId = null, timestamp = null) {
        const wrapper = createMessageWrapper(messageId || Date.now());
        const div = document.createElement('div');

        if (type === 'me') {
            div.className = 'message me';
        } else {
            div.className = 'message other';
        }

        const wrapperDiv = document.createElement('div');
        wrapperDiv.className = 'voice-message-wrapper';

        const playBtn = document.createElement('button');
        playBtn.className = 'voice-play-btn';
        playBtn.textContent = '▶️';
        playBtn.addEventListener('click', () => {
            playVoiceMessage(audioData);
        });

        const waveform = document.createElement('div');
        waveform.className = 'voice-waveform';
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'voice-bar';
            bar.style.height = (5 + Math.random() * 25) + 'px';
            bar.style.animationDelay = (Math.random() * 0.5) + 's';
            waveform.appendChild(bar);
        }

        const durationLabel = document.createElement('span');
        durationLabel.className = 'voice-duration';
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60);
        durationLabel.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

        wrapperDiv.appendChild(playBtn);
        wrapperDiv.appendChild(waveform);
        wrapperDiv.appendChild(durationLabel);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        div.appendChild(wrapperDiv);
        div.appendChild(time);
        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
        return wrapper;
    }

    function playVoiceMessage(audioData) {
        const modal = document.getElementById('audioPlayerModal');
        const audioPlayer = document.getElementById('audioPlayer');
        audioPlayer.src = audioData;
        modal.classList.add('show');
        audioPlayer.play();
    }

    function openImageModal(imageData) {
        const modal = document.getElementById('imageModal');
        const modalImg = document.getElementById('modalImage');
        const downloadBtn = document.getElementById('downloadBtn');

        modal.classList.add('show');
        modalImg.src = imageData;
        downloadBtn.href = imageData;
        downloadBtn.download = 'quickie-image.jpg';
    }

    function downloadImage(imageData, filename) {
        const link = document.createElement('a');
        link.href = imageData;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || !currentRoomId || !socket) return;

        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
        if (isTyping) {
            isTyping = false;
            socket.emit('typing', { roomId: currentRoomId, isTyping: false });
        }

        const messageId = ++messageIdCounter;
        const replyData = replyToMessage ? {
            id: replyToMessage.id,
            text: replyToMessage.text,
            from: replyToMessage.from
        } : null;

        const messageData = {
            id: messageId,
            text: text,
            from: socket.id,
            timestamp: Date.now(),
            type: 'text',
            deleted: false,
            replyTo: replyData
        };

        // Add to current chat
        allMessages.push(messageData);
        if (currentChatId) {
            addMessageToChat(currentChatId, messageData);
        }

        socket.emit('chat-message', {
            roomId: currentRoomId,
            text,
            messageId,
            replyTo: replyData
        });

        appendMessage(text, 'me', messageId, null, replyData);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        chatInput.focus();
        replyToMessage = null;
        updateReplyPreview();
    }

    // ===== Voice Recording =====
    function startRecording() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                recordingSeconds = 0;
                isRecording = true;

                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        const audioData = reader.result;
                        const messageId = Date.now() + '_voice';

                        const messageData = {
                            id: messageId,
                            audioData: audioData,
                            duration: recordingSeconds,
                            from: socket.id,
                            timestamp: Date.now(),
                            type: 'voice',
                            deleted: false
                        };

                        allMessages.push(messageData);
                        if (currentChatId) {
                            addMessageToChat(currentChatId, messageData);
                        }
                        appendVoiceMessage(audioData, recordingSeconds, 'me', messageId, Date.now());

                        socket.emit('voice-message', {
                            roomId: currentRoomId,
                            audioData: audioData,
                            duration: recordingSeconds,
                            messageId: messageId
                        });

                        document.getElementById('voiceModal').classList.remove('show');
                        document.getElementById('voiceBtn').classList.remove('recording');
                    };
                    reader.readAsDataURL(audioBlob);

                    stream.getTracks().forEach(track => track.stop());
                    isRecording = false;
                };

                mediaRecorder.start();
                document.getElementById('voiceModal').classList.add('show');
                document.getElementById('voiceBtn').classList.add('recording');

                recordingSeconds = 0;
                if (recordingTimer) clearInterval(recordingTimer);
                recordingTimer = setInterval(() => {
                    recordingSeconds++;
                    const mins = Math.floor(recordingSeconds / 60);
                    const secs = recordingSeconds % 60;
                    document.getElementById('voiceTimer').textContent =
                        `${mins}:${secs.toString().padStart(2, '0')}`;
                }, 1000);
            })
            .catch(err => {
                alert('Microphone access is required for voice messages.');
                console.error(err);
            });
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            if (recordingTimer) {
                clearInterval(recordingTimer);
                recordingTimer = null;
            }
        }
    }

    function cancelRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            if (recordingTimer) {
                clearInterval(recordingTimer);
                recordingTimer = null;
            }
            document.getElementById('voiceModal').classList.remove('show');
            document.getElementById('voiceBtn').classList.remove('recording');
            isRecording = false;
        }
    }

    // ===== Auto-expand Textarea =====
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });

    // ===== Event Listeners =====

    // Logo click - return to main menu
    document.getElementById('logo').addEventListener('click', () => {
        if (chatScreen.classList.contains('active')) {
            if (confirm('Leave this chat and go back to the main menu?')) {
                goToMainMenu();
                if (socket && currentRoomId) {
                    socket.emit('chat-message', {
                        roomId: currentRoomId,
                        text: '👋 The user has left the chat'
                    });
                }
            }
        }
    });

    document.getElementById('logoHeader').addEventListener('click', () => {
        if (chatScreen.classList.contains('active')) {
            if (confirm('Leave this chat and go back to the main menu?')) {
                goToMainMenu();
                if (socket && currentRoomId) {
                    socket.emit('chat-message', {
                        roomId: currentRoomId,
                        text: '👋 The user has left the chat'
                    });
                }
            }
        }
    });

    createBtn.addEventListener('click', async () => {
        if (!socket || !socket.id) {
            setError('Connecting to server... try again in a sec.');
            return;
        }
        try {
            const res = await fetch(`/create?socketId=${socket.id}`);
            const data = await res.json();
            if (data.otp) {
                otpDisplay.textContent = data.otp;
                otpDisplay.classList.add('show');

                timerSeconds = 120;
                if (timerInterval) clearInterval(timerInterval);
                timerInterval = setInterval(() => {
                    timerSeconds--;
                    if (timerSeconds <= 0) {
                        clearInterval(timerInterval);
                        timerInterval = null;
                        otpDisplay.classList.remove('show');
                        setError('⏳ Code expired. Create a new one.');
                        return;
                    }
                    const minutes = Math.floor(timerSeconds / 60);
                    const seconds = timerSeconds % 60;
                    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                    setError(`✅ Share this code · Expires in ${timeStr}`);
                }, 1000);

                setTimeout(() => {
                    if (otpDisplay.classList.contains('show')) {
                        otpDisplay.classList.remove('show');
                        if (timerInterval) {
                            clearInterval(timerInterval);
                            timerInterval = null;
                        }
                        setError('⏳ Code expired. Create a new one.');
                    }
                }, 120000);
            } else {
                setError('Failed to create chat. Try again.');
            }
        } catch (e) {
            setError('Network error. Is the server running?');
        }
    });

    joinBtn.addEventListener('click', () => {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        const otp = otpInput.value.trim();
        if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
            setError('Please enter a valid 6-digit code');
            return;
        }
        if (!socket || !socket.id) {
            setError('Socket not ready. Wait a moment.');
            return;
        }
        socket.emit('join-with-otp', otp);
        setError('Connecting...');
    });

    leaveBtn.addEventListener('click', () => {
        if (confirm('Leave this chat?')) {
            goToMainMenu();
            if (socket && currentRoomId) {
                socket.emit('chat-message', {
                    roomId: currentRoomId,
                    text: '👋 The other user has left the chat'
                });
            }
        }
    });

    // Refresh button - silent refresh
    refreshBtn.addEventListener('click', refreshChat);

    // Sidebar toggle
    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarCloseBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Send message
    sendBtn.addEventListener('click', sendMessage);

    // Ctrl+Enter to send (Shift+Enter for new line)
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', () => {
        if (!currentRoomId || !socket) return;

        const hasText = chatInput.value.trim().length > 0;

        if (hasText && !isTyping) {
            isTyping = true;
            socket.emit('typing', { roomId: currentRoomId, isTyping: true });
        }

        if (!hasText && isTyping) {
            isTyping = false;
            socket.emit('typing', { roomId: currentRoomId, isTyping: false });
        }

        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (isTyping) {
                isTyping = false;
                socket.emit('typing', { roomId: currentRoomId, isTyping: false });
            }
        }, 2000);
    });

    otpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinBtn.click();
    });

    // ===== Quick Replies =====
    document.querySelectorAll('.quick-reply').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.text;
            chatInput.value = text;
            sendMessage();
        });
    });

    // ===== Search =====
    document.getElementById('searchBtn').addEventListener('click', toggleSearch);
    document.getElementById('searchCloseBtn').addEventListener('click', toggleSearch);

    document.getElementById('searchInput').addEventListener('input', (e) => {
        performSearch(e.target.value);
    });

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            toggleSearch();
        }
    });

    // ===== Voice Recording =====
    document.getElementById('voiceBtn').addEventListener('click', () => {
        if (!currentRoomId) return;
        startRecording();
    });

    document.getElementById('stopRecordingBtn').addEventListener('click', stopRecording);
    document.getElementById('cancelRecordingBtn').addEventListener('click', cancelRecording);

    // ===== Audio Player =====
    document.getElementById('closeAudioBtn').addEventListener('click', () => {
        document.getElementById('audioPlayerModal').classList.remove('show');
        document.getElementById('audioPlayer').pause();
    });

    // ===== Emoji Picker =====
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');

    emojiBtn.addEventListener('click', () => {
        emojiPicker.classList.toggle('show');
    });

    emojiPicker.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.textContent;
            const cursorPos = chatInput.selectionStart;
            const text = chatInput.value;
            chatInput.value = text.slice(0, cursorPos) + emoji + text.slice(cursorPos);
            chatInput.focus();
            chatInput.selectionStart = chatInput.selectionEnd = cursorPos + emoji.length;
            emojiPicker.classList.remove('show');
            chatInput.dispatchEvent(new Event('input'));
        });
    });

    document.addEventListener('click', (e) => {
        if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.remove('show');
        }
    });

    // ===== Image Sharing =====
    const imageBtn = document.getElementById('imageBtn');
    const imageInput = document.getElementById('imageInput');

    imageBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        sendImage(file);
        imageInput.value = '';
    });

    // ===== File Sharing =====
    const fileBtn = document.getElementById('fileBtn');
    const fileInput = document.getElementById('fileInput');

    fileBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        sendFile(file);
        fileInput.value = '';
    });

    // ===== Image Modal =====
    const modal = document.getElementById('imageModal');
    const closeModal = document.getElementById('closeModal');

    closeModal.addEventListener('click', () => {
        modal.classList.remove('show');
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modal.classList.remove('show');
            document.getElementById('audioPlayerModal').classList.remove('show');
            document.getElementById('audioPlayer').pause();
            document.getElementById('searchBar').classList.remove('show');
        }
    });

    // ===== Dark Mode =====
    const darkModeToggle = document.getElementById('darkModeToggle');

    if (localStorage.getItem('darkMode') === 'enabled') {
        document.body.classList.add('dark-mode');
        darkModeToggle.textContent = '☀️';
    }

    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        darkModeToggle.textContent = isDark ? '☀️' : '🌙';
        localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
    });

    // ===== Socket Events =====

    socket.on('paired', ({ roomId }) => {
        // Create chat entry
        const chatId = `chat_${roomId}`;
        const partnerName = 'Partner'; // Will be updated from history

        // Check if chat already exists in localStorage
        let existingChat = allChats.find(c => c.id === chatId);
        if (!existingChat) {
            addChat(chatId, mySocketId, partnerName);
        }

        enterChat(roomId, chatId);
        setError('');
        otpDisplay.classList.remove('show');
        appendMessage('🔗 You are now connected!', 'system');
        socket.emit('status-update', { roomId, status: 'online' });
    });

    socket.on('user-status', ({ userId, status }) => {
        if (userId !== mySocketId) {
            updateStatus(status);
        }
    });

    socket.on('chat-history', ({ chatId, messages, partnerId }) => {
        if (isFirstHistoryLoad) {
            messageList.innerHTML = '';
            allMessages = [];
            isFirstHistoryLoad = false;
        }

        // Update chat partner name if available
        if (chatId) {
            const chat = getChat(chatId);
            if (chat && partnerId) {
                // Partner name will be set from the server later
            }
        }

        allMessages = messages;
        messages.forEach(msg => {
            if (msg.deleted) {
                if (msg.type === 'text') {
                    appendMessage('This message was deleted', msg.from === socket.id ? 'me' : 'other', msg.id, msg.timestamp);
                }
                return;
            }

            if (msg.type === 'text') {
                appendMessage(msg.text, msg.from === socket.id ? 'me' : 'other', msg.id, msg.timestamp, msg.replyTo);
            } else if (msg.type === 'image') {
                appendImage(msg.image, msg.from === socket.id ? 'me' : 'other', msg.id, msg.timestamp);
            } else if (msg.type === 'voice') {
                appendVoiceMessage(msg.audioData, msg.duration, msg.from === socket.id ? 'me' : 'other', msg.id, msg.timestamp);
            } else if (msg.type === 'file') {
                appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, msg.from === socket.id ? 'me' : 'other', msg.id, msg.timestamp);
            }
        });
        scrollToBottom();
        if (messages.length > 0) {
            lastSyncTime = messages[messages.length - 1].timestamp;
        }
    });

    socket.on('chat-message', (msg) => {
        if (msg.from === socket.id) return;
        if (msg.deleted) {
            appendMessage('This message was deleted', 'other', msg.id, msg.timestamp);
            return;
        }

        const messageData = {
            id: msg.id,
            text: msg.text,
            from: msg.from,
            timestamp: msg.timestamp,
            type: 'text',
            deleted: false,
            replyTo: msg.replyTo || null
        };

        if (currentChatId) {
            addMessageToChat(currentChatId, messageData);
        }
        appendMessage(msg.text, 'other', msg.id, msg.timestamp, msg.replyTo);
        playNotificationSound();
        sendPushNotification('Quickie', `${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`);
    });

    socket.on('chat-image', (msg) => {
        if (msg.from === socket.id) return;
        if (msg.deleted) {
            appendMessage('Image was deleted', 'other', msg.id, msg.timestamp);
            return;
        }

        const messageData = {
            id: msg.id,
            image: msg.image,
            fileName: msg.fileName,
            from: msg.from,
            timestamp: msg.timestamp,
            type: 'image',
            deleted: false
        };

        if (currentChatId) {
            addMessageToChat(currentChatId, messageData);
        }
        appendImage(msg.image, 'other', msg.id, msg.timestamp);
        playNotificationSound();
        sendPushNotification('Quickie', '📸 Image shared');
    });

    socket.on('chat-file', (msg) => {
        if (msg.from === socket.id) return;
        if (msg.deleted) {
            appendMessage('File was deleted', 'other', msg.id, msg.timestamp);
            return;
        }

        const messageData = {
            id: msg.id,
            fileData: msg.fileData,
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            from: msg.from,
            timestamp: msg.timestamp,
            type: 'file',
            deleted: false
        };

        if (currentChatId) {
            addMessageToChat(currentChatId, messageData);
        }
        appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, 'other', msg.id, msg.timestamp);
        playNotificationSound();
        sendPushNotification('Quickie', `📄 File shared: ${msg.fileName}`);
    });

    socket.on('voice-message', (msg) => {
        if (msg.from === socket.id) return;
        if (msg.deleted) {
            appendMessage('Voice message was deleted', 'other', msg.id, msg.timestamp);
            return;
        }

        const messageData = {
            id: msg.id,
            audioData: msg.audioData,
            duration: msg.duration,
            from: msg.from,
            timestamp: msg.timestamp,
            type: 'voice',
            deleted: false
        };

        if (currentChatId) {
            addMessageToChat(currentChatId, messageData);
        }
        appendVoiceMessage(msg.audioData, msg.duration, 'other', msg.id, msg.timestamp);
        playNotificationSound();
        sendPushNotification('Quickie', '🎤 Voice message received');
    });

    socket.on('reaction-update', ({ messageId, reactions }) => {
        const wrapper = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!wrapper) return;

        const existingReactions = wrapper.querySelector('.message-reactions');
        if (existingReactions) {
            existingReactions.remove();
        }

        const reactionCounts = {};
        Object.values(reactions).forEach(emoji => {
            reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        });

        if (Object.keys(reactionCounts).length > 0) {
            const container = document.createElement('div');
            container.className = 'message-reactions';

            Object.entries(reactionCounts).forEach(([emoji, count]) => {
                const badge = document.createElement('span');
                badge.className = 'reaction-badge';
                badge.innerHTML = `${emoji} <span class="count">${count}</span>`;
                container.appendChild(badge);
            });

            wrapper.querySelector('.message').appendChild(container);
        }
    });

    socket.on('message-deleted', ({ messageId }) => {
        const wrapper = document.querySelector(`[data-message-id="${messageId}"]`);
        if (wrapper) {
            const messageDiv = wrapper.querySelector('.message');
            while (messageDiv.firstChild) {
                messageDiv.removeChild(messageDiv.firstChild);
            }
            messageDiv.textContent = 'This message was deleted';
            messageDiv.classList.add('deleted');
            const reactions = wrapper.querySelector('.message-reactions');
            if (reactions) reactions.remove();
            const actions = wrapper.querySelector('.message-actions');
            if (actions) actions.remove();
        }

        const msgIndex = allMessages.findIndex(m => m.id === messageId);
        if (msgIndex !== -1) {
            allMessages[msgIndex].deleted = true;
            allMessages[msgIndex].text = 'This message was deleted';
            if (allMessages[msgIndex].fileData) {
                allMessages[msgIndex].fileData = null;
            }
            if (allMessages[msgIndex].image) {
                allMessages[msgIndex].image = null;
            }
            if (allMessages[msgIndex].audioData) {
                allMessages[msgIndex].audioData = null;
            }
        } else {
            allMessages.push({
                id: messageId,
                text: 'This message was deleted',
                deleted: true,
                type: 'text',
                timestamp: Date.now(),
                from: 'unknown'
            });
        }
    });

    socket.on('error', (msg) => {
        setError('❌ ' + msg);
    });

    socket.on('disconnect', () => {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        if (chatScreen.classList.contains('active')) {
            appendMessage('⚠️ Disconnected from server', 'system');
        }
    });

    socket.on('partner-left', () => {
        appendMessage('👋 The other user has left the chat', 'system');
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
        setTimeout(() => {
            goToMainMenu();
        }, 3000);
    });

    socket.on('user-typing', ({ isTyping }) => {
        const typingIndicator = document.getElementById('typingIndicator');
        if (isTyping) {
            typingIndicator.textContent = '👤 is typing...';
            typingIndicator.style.display = 'block';
        } else {
            typingIndicator.style.display = 'none';
        }
    });

    socket.on('rejoin-success', ({ roomId }) => {
        console.log('✅ Reconnected successfully!');
        socket.emit('status-update', { roomId, status: 'online' });
    });

    socket.on('rejoin-failed', ({ roomId }) => {
        console.log('Rejoin failed for room:', roomId);
        sessionStorage.removeItem('quickie_roomId');
        if (chatScreen.classList.contains('active')) {
            appendMessage('⚠️ Chat session expired. Please create a new chat.', 'system');
            setTimeout(() => {
                goToMainMenu();
            }, 2000);
        }
    });

    // ===== Initialize =====
    otpInput.focus();

    // Load chats from localStorage on startup
    loadChatsFromLocal();
})();