(function () {
    console.log('🚀 Quickie app started!');

    // ===== DOM References =====
    const loginScreen = document.getElementById('loginScreen');
    const chatMenu = document.getElementById('chatMenu');
    const phoneInput = document.getElementById('phoneInput');
    const generatePinBtn = document.getElementById('generatePinBtn');
    const recoverPinBtn = document.getElementById('recoverPinBtn');
    const pinDisplayArea = document.getElementById('pinDisplayArea');
    const pinDisplay = document.getElementById('pinDisplay');
    const copyPinBtn = document.getElementById('copyPinBtn');
    const loginAfterGenerateBtn = document.getElementById('loginAfterGenerateBtn');
    const loginPinInput = document.getElementById('loginPinInput');
    const loginBtn = document.getElementById('loginBtn');
    const friendPinInput = document.getElementById('friendPinInput');
    const friendNameInput = document.getElementById('friendNameInput');
    const addFriendBtn = document.getElementById('addFriendBtn');
    const loginError = document.getElementById('loginError');
    const userPinDisplay = document.getElementById('userPinDisplay');
    const userPhoneDisplay = document.getElementById('userPhoneDisplay');
    const userNameInput = document.getElementById('userNameInput');
    const saveNameBtn = document.getElementById('saveNameBtn');
    const pendingList = document.getElementById('pendingList');
    const chatList = document.getElementById('chatList');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
    const partnerName = document.getElementById('partnerName');
    const partnerPin = document.getElementById('partnerPin');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const messageList = document.getElementById('messageList');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const leaveBtn = document.getElementById('leaveBtn');
    const searchBtn = document.getElementById('searchBtn');
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');
    const searchCloseBtn = document.getElementById('searchCloseBtn');
    const searchResults = document.getElementById('searchResults');
    const emojiBtn = document.getElementById('emojiBtn');
    const emojiPicker = document.getElementById('emojiPicker');
    const imageBtn = document.getElementById('imageBtn');
    const imageInput = document.getElementById('imageInput');
    const fileBtn = document.getElementById('fileBtn');
    const fileInput = document.getElementById('fileInput');
    const voiceBtn = document.getElementById('voiceBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const addFriendFromSidebar = document.getElementById('addFriendFromSidebar');
    const darkModeToggle = document.getElementById('darkModeToggle');

    // ===== State =====
    let socket = null;
    let myPin = null;
    let myPhone = null;
    let myName = '';
    let currentChatId = null;
    let currentPartnerPin = null;
    let currentPartnerName = '';
    let allChats = [];
    let allMessages = [];
    let pendingRequests = [];
    let typingTimeout = null;
    let messageIdCounter = 0;
    let isFirstHistoryLoad = true;
    let mediaRecorder = null;
    let audioChunks = [];
    let recordingTimer = null;
    let recordingSeconds = 0;
    let isRecording = false;

    // ===== Set Error =====
    function setError(msg) {
        loginError.textContent = msg;
        if (msg) setTimeout(() => { loginError.textContent = ''; }, 5000);
    }

    // ===== Phone Number Formatting =====
    function formatPhoneDisplay(phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length <= 3) return '+' + cleaned;
        if (cleaned.length <= 6) return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3);
        if (cleaned.length <= 9) return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6);
        return '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6, 10);
    }

    function cleanPhone(phone) {
        return phone.replace(/\s/g, '').replace(/-/g, '');
    }

    // ===== PIN Generation =====
    async function handlePinAction(action) {
        const phone = cleanPhone(phoneInput.value);
        if (!phone || phone.length < 7) {
            setError('Please enter a valid phone number');
            return;
        }

        try {
            const res = await fetch(`/pin?phone=${encodeURIComponent(phone)}&action=${action}`);
            const data = await res.json();

            if (res.ok) {
                myPin = data.pin;
                myPhone = phone;
                pinDisplay.textContent = myPin;
                pinDisplayArea.classList.remove('hidden');
                copyPinBtn.classList.remove('hidden');
                loginAfterGenerateBtn.classList.remove('hidden');
                setError(data.message);

                if (action === 'generate') {
                    loginWithPin(myPin);
                }
            } else {
                setError(data.error || 'Something went wrong');
            }
        } catch (e) {
            setError('Network error. Is the server running?');
        }
    }

    generatePinBtn.addEventListener('click', () => handlePinAction('generate'));
    recoverPinBtn.addEventListener('click', () => handlePinAction('recover'));

    copyPinBtn.addEventListener('click', function () {
        if (myPin) {
            navigator.clipboard.writeText(myPin).then(() => {
                setError('✅ PIN copied to clipboard!');
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = myPin;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                setError('✅ PIN copied to clipboard!');
            });
        }
    });

    loginAfterGenerateBtn.addEventListener('click', function () {
        if (myPin) {
            loginWithPin(myPin);
        }
    });

    // ===== Login =====
    loginBtn.addEventListener('click', function () {
        const pin = loginPinInput.value.trim().toUpperCase();
        if (!pin || pin.length !== 8) {
            setError('Please enter a valid 8-character PIN');
            return;
        }
        loginWithPin(pin);
    });

    loginPinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            loginBtn.click();
        }
    });

    function loginWithPin(pin) {
        myPin = pin;
        if (socket && socket.connected) {
            socket.emit('register', { pin, phone: myPhone, name: myName });
        } else {
            connectSocket();
            socket.once('connect', () => {
                socket.emit('register', { pin, phone: myPhone, name: myName });
            });
        }
    }

    // ===== Socket Connection =====
    function connectSocket() {
        socket = io();

        socket.on('connect', () => {
            console.log('✅ Socket connected');
            if (myPin) {
                socket.emit('register', { pin: myPin, phone: myPhone, name: myName });
            }
        });

        socket.on('connect_error', () => {
            setError('⚠️ Cannot reach server. Make sure server is running.');
        });

        // ===== Registration Success =====
        socket.on('registered', ({ pin, name, phone }) => {
            console.log('✅ Registered:', pin, name);
            myName = name || '';
            myPhone = phone || myPhone;
            loginScreen.style.display = 'none';
            chatMenu.classList.add('active');
            userPinDisplay.textContent = pin;
            if (myPhone) userPhoneDisplay.textContent = myPhone;
            if (myName) userNameInput.value = myName;
            setError('');
            loadChats();
        });

        // ===== Pending Requests =====
        socket.on('pending-requests', (requests) => {
            console.log('📨 Pending requests received:', requests.length);
            pendingRequests = requests;
            renderPendingRequests();
        });

        // ===== New Request =====
        socket.on('new-request', ({ fromPin, fromName, timestamp }) => {
            console.log('📨 New request received from:', fromPin, fromName);
            const exists = pendingRequests.some(r => r.fromPin === fromPin);
            if (!exists) {
                pendingRequests.push({ fromPin, fromName, timestamp });
                renderPendingRequests();
                playNotificationSound();
                setError(`📨 New request from ${fromName || fromPin}!`);
            }
        });

        // ===== Request Accepted =====
        socket.on('request-accepted', ({ withPin, withName, chatId }) => {
            setError(`✅ ${withName || withPin} accepted your request!`);
            const chat = {
                pin: withPin,
                name: withName || withPin,
                chatId: chatId,
                lastMessage: 'Chat started!',
                lastTimestamp: Date.now()
            };
            if (!allChats.find(c => c.chatId === chatId)) {
                allChats.push(chat);
            }
            renderChatList();
            saveChatsToLocal();
            switchChat(chatId, withPin, withName || withPin);
            playNotificationSound();
        });

        // ===== Request Declined =====
        socket.on('request-declined', ({ byPin, byName }) => {
            setError(`❌ ${byName || byPin} declined your request.`);
            pendingRequests = pendingRequests.filter(r => r.fromPin !== byPin);
            renderPendingRequests();
        });

        // ===== Request Cancelled =====
        socket.on('request-cancelled', ({ fromPin }) => {
            pendingRequests = pendingRequests.filter(r => r.fromPin !== fromPin);
            renderPendingRequests();
            setError(`Request to ${fromPin} was cancelled.`);
        });

        // ===== Request Expired =====
        socket.on('request-expired', ({ fromPin }) => {
            if (fromPin) {
                pendingRequests = pendingRequests.filter(r => r.fromPin !== fromPin);
                renderPendingRequests();
                setError(`⏳ Request from ${fromPin} expired.`);
            }
        });

        // ===== Chat History =====
        socket.on('chat-history', ({ chatId, messages }) => {
            if (isFirstHistoryLoad) {
                messageList.innerHTML = '';
                allMessages = [];
                isFirstHistoryLoad = false;
            }
            allMessages = messages || [];
            allMessages.forEach(msg => {
                displayMessage(msg);
            });
            scrollToBottom();
        });

        // ===== Text Message =====
        socket.on('chat-message', (msg) => {
            if (msg.from === myPin) return;
            if (msg.deleted) {
                appendMessage('This message was deleted', 'other', msg.id, msg.timestamp);
                return;
            }
            displayMessage(msg);
            playNotificationSound();
        });

        // ===== Image Message =====
        socket.on('chat-image', (msg) => {
            if (msg.from === myPin) return;
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
            allMessages.push(messageData);
            if (msg.chatId === currentChatId) {
                appendImage(msg.image, 'other', msg.id, msg.timestamp);
            }
            updateChatPreview(msg.chatId, '📸 Image', msg.timestamp);
            playNotificationSound();
        });

        // ===== File Message =====
        socket.on('chat-file', (msg) => {
            if (msg.from === myPin) return;
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
            allMessages.push(messageData);
            if (msg.chatId === currentChatId) {
                appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, 'other', msg.id, msg.timestamp);
            }
            updateChatPreview(msg.chatId, `📄 ${msg.fileName}`, msg.timestamp);
            playNotificationSound();
        });

        // ===== Voice Message (FIXED) =====
        socket.on('voice-message', (msg) => {
            console.log('🎤 Voice message received from:', msg.from, 'duration:', msg.duration);
            console.log('📊 Audio data available:', msg.audioData ? 'yes' : 'no');

            if (msg.from === myPin) {
                console.log('⏭️ Skipping own voice message');
                return;
            }
            if (msg.deleted) {
                appendMessage('Voice was deleted', 'other', msg.id, msg.timestamp);
                return;
            }

            const messageData = {
                id: msg.id,
                audioData: msg.audioData,
                duration: msg.duration || 0,
                from: msg.from,
                timestamp: msg.timestamp,
                type: 'voice',
                deleted: false
            };

            allMessages.push(messageData);

            if (msg.chatId === currentChatId) {
                appendVoiceMessage(msg.audioData, msg.duration, 'other', msg.id, msg.timestamp);
            }

            updateChatPreview(msg.chatId, '🎤 Voice', msg.timestamp);
            playNotificationSound();
        });

        // ===== Partner Left =====
        socket.on('partner-left-chat', ({ chatId }) => {
            if (chatId === currentChatId) {
                appendMessage('👋 The other user left this chat', 'system');
                allChats = allChats.filter(c => c.chatId !== chatId);
                renderChatList();
                saveChatsToLocal();
                if (currentChatId === chatId) {
                    currentChatId = null;
                    currentPartnerPin = null;
                    currentPartnerName = '';
                    partnerName.textContent = 'Select a chat';
                    partnerPin.textContent = '';
                    messageList.innerHTML = '';
                }
            }
        });

        // ===== Chat Deleted =====
        socket.on('chat-deleted', ({ chatId }) => {
            allChats = allChats.filter(c => c.chatId !== chatId);
            renderChatList();
            saveChatsToLocal();
            if (currentChatId === chatId) {
                currentChatId = null;
                currentPartnerPin = null;
                currentPartnerName = '';
                partnerName.textContent = 'Select a chat';
                partnerPin.textContent = '';
                messageList.innerHTML = '';
            }
        });

        // ===== Typing Indicator =====
        socket.on('user-typing', ({ chatId, isTyping }) => {
            if (chatId !== currentChatId) return;
            const typingIndicator = document.getElementById('typingIndicator');
            if (typingIndicator) {
                if (isTyping) {
                    typingIndicator.textContent = '👤 is typing...';
                    typingIndicator.style.display = 'block';
                } else {
                    typingIndicator.style.display = 'none';
                }
            }
        });

        // ===== Name Updated =====
        socket.on('name-updated', ({ name }) => {
            myName = name;
            renderChatList();
        });

        // ===== Error =====
        socket.on('error', (msg) => {
            setError('❌ ' + msg);
        });

        // ===== Request Sent =====
        socket.on('request-sent', ({ toPin }) => {
            setError(`✅ Request sent to ${toPin}!`);
        });

        // ===== Request Cancelled Success =====
        socket.on('request-cancelled-success', () => {
            setError('✅ Request cancelled.');
        });

        // ===== Request Declined Success =====
        socket.on('request-declined-success', () => {
            setError('✅ Request declined.');
        });
    }

    // ===== Load Chats =====
    function loadChats() {
        const saved = localStorage.getItem('quickie_chats_' + myPin);
        if (saved) {
            try {
                allChats = JSON.parse(saved);
                renderChatList();
            } catch (e) {
                allChats = [];
            }
        }
        if (socket) {
            socket.emit('get-pending-requests', { pin: myPin });
        }
    }

    function saveChatsToLocal() {
        if (myPin) {
            localStorage.setItem('quickie_chats_' + myPin, JSON.stringify(allChats));
        }
    }

    function updateChatPreview(chatId, message, timestamp) {
        const chat = allChats.find(c => c.chatId === chatId);
        if (chat) {
            chat.lastMessage = message;
            chat.lastTimestamp = timestamp || Date.now();
            renderChatList();
            saveChatsToLocal();
        }
    }

    // ===== Render Pending Requests =====
    function renderPendingRequests() {
        pendingList.innerHTML = '';
        if (pendingRequests.length === 0) {
            pendingList.innerHTML = '<div class="no-requests">No pending requests</div>';
            return;
        }
        pendingRequests.forEach(req => {
            const item = document.createElement('div');
            item.className = 'request-item';
            const time = new Date(req.timestamp);
            const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            item.innerHTML = `
        <div class="request-info">
          <div class="request-name">${req.fromName || req.fromPin}</div>
          <div class="request-pin">PIN: ${req.fromPin}</div>
          <div class="request-time">${timeStr}</div>
        </div>
        <div class="request-actions">
          <button class="btn-small accept-btn" data-pin="${req.fromPin}">Accept</button>
          <button class="btn-small decline-btn" data-pin="${req.fromPin}">Decline</button>
        </div>
      `;

            item.querySelector('.accept-btn').addEventListener('click', function () {
                const fromPin = this.dataset.pin;
                socket.emit('accept-request', { fromPin, toPin: myPin });
                pendingRequests = pendingRequests.filter(r => r.fromPin !== fromPin);
                renderPendingRequests();
            });

            item.querySelector('.decline-btn').addEventListener('click', function () {
                const fromPin = this.dataset.pin;
                socket.emit('decline-request', { fromPin, toPin: myPin });
                pendingRequests = pendingRequests.filter(r => r.fromPin !== fromPin);
                renderPendingRequests();
            });

            pendingList.appendChild(item);
        });
    }

    // ===== Render Chat List =====
    function renderChatList() {
        chatList.innerHTML = '<div class="section-title">💬 Active Chats</div>';

        if (allChats.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding: 1rem; text-align: center; color: #6b7280; font-size: 0.85rem;';
            empty.textContent = 'No chats yet. Add a friend to start!';
            chatList.appendChild(empty);
            return;
        }

        const sortedChats = [...allChats].sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

        sortedChats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'chat-item';
            if (chat.chatId === currentChatId) {
                item.classList.add('active');
            }

            const avatar = document.createElement('div');
            avatar.className = 'chat-item-avatar';
            avatar.textContent = (chat.name || chat.pin).charAt(0).toUpperCase();
            avatar.style.background = getColorFromString(chat.pin);

            const info = document.createElement('div');
            info.className = 'chat-item-info';

            const name = document.createElement('div');
            name.className = 'chat-item-name';
            name.innerHTML = `${chat.name || chat.pin} <span class="chat-pin">(${chat.pin})</span>`;

            const preview = document.createElement('div');
            preview.className = 'chat-item-preview';
            preview.textContent = chat.lastMessage || 'Start chatting...';

            info.appendChild(name);
            info.appendChild(preview);

            const right = document.createElement('div');
            right.className = 'chat-item-right';

            const time = document.createElement('span');
            time.className = 'chat-item-time';
            if (chat.lastTimestamp) {
                time.textContent = formatTime(chat.lastTimestamp);
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'chat-delete-btn';
            deleteBtn.textContent = '🗑';
            deleteBtn.title = 'Delete this chat';
            deleteBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (confirm('Delete this chat? All messages will be permanently deleted.')) {
                    socket.emit('delete-chat', { chatId: chat.chatId, pin: myPin });
                    allChats = allChats.filter(c => c.chatId !== chat.chatId);
                    renderChatList();
                    saveChatsToLocal();
                    if (currentChatId === chat.chatId) {
                        currentChatId = null;
                        currentPartnerPin = null;
                        currentPartnerName = '';
                        partnerName.textContent = 'Select a chat';
                        partnerPin.textContent = '';
                        messageList.innerHTML = '';
                    }
                }
            });

            right.appendChild(time);
            right.appendChild(deleteBtn);

            item.appendChild(avatar);
            item.appendChild(info);
            item.appendChild(right);

            item.addEventListener('click', function () {
                switchChat(chat.chatId, chat.pin, chat.name || chat.pin);
                closeSidebar();
            });

            chatList.appendChild(item);
        });
    }

    // ===== Switch Chat =====
    function switchChat(chatId, pin, name) {
        currentChatId = chatId;
        currentPartnerPin = pin;
        currentPartnerName = name;
        partnerName.textContent = name || pin;
        partnerPin.textContent = pin;
        messageList.innerHTML = '';
        allMessages = [];
        isFirstHistoryLoad = true;

        socket.emit('get-chat-history', { chatId });
        renderChatList();
    }

    // ===== Add Friend =====
    addFriendBtn.addEventListener('click', function () {
        const toPin = friendPinInput.value.trim().toUpperCase();
        const fromName = friendNameInput.value.trim() || myName || 'User';

        if (!toPin || toPin.length !== 8) {
            setError('Please enter a valid 8-character PIN');
            return;
        }
        if (toPin === myPin) {
            setError('You cannot add yourself!');
            return;
        }

        socket.emit('send-request', { fromPin: myPin, toPin, fromName });
        setError(`📤 Request sent to ${toPin}`);
        friendPinInput.value = '';
        friendNameInput.value = '';
    });

    friendPinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            addFriendBtn.click();
        }
    });

    // ===== Logout =====
    logoutBtn.addEventListener('click', function () {
        if (confirm('Logout?')) {
            myPin = null;
            myPhone = null;
            myName = '';
            allChats = [];
            allMessages = [];
            pendingRequests = [];
            currentChatId = null;
            currentPartnerPin = null;
            currentPartnerName = '';
            chatMenu.classList.remove('active');
            loginScreen.style.display = 'flex';
            loginPinInput.value = '';
            loginPinInput.focus();
            pinDisplay.textContent = '- - - - - - - -';
            pinDisplayArea.classList.add('hidden');
            copyPinBtn.classList.add('hidden');
            loginAfterGenerateBtn.classList.add('hidden');
            if (socket) socket.disconnect();
            localStorage.removeItem('quickie_chats_' + myPin);
        }
    });

    // ===== Add Friend from Sidebar =====
    addFriendFromSidebar.addEventListener('click', function () {
        closeSidebar();
        loginScreen.style.display = 'flex';
        chatMenu.classList.remove('active');
        friendPinInput.focus();
    });

    // ===== Save Name =====
    saveNameBtn.addEventListener('click', function () {
        const name = userNameInput.value.trim();
        if (name) {
            myName = name;
            if (socket && socket.connected) {
                socket.emit('update-name', { pin: myPin, name });
            }
            setError('✅ Name saved!');
        }
    });

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

    sidebarToggle.addEventListener('click', toggleSidebar);
    sidebarCloseBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // ===== Send Message =====
    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || !currentChatId || !socket) return;

        const messageId = ++messageIdCounter;
        const messageData = {
            id: messageId,
            text: text,
            from: myPin,
            timestamp: Date.now(),
            type: 'text',
            deleted: false
        };

        allMessages.push(messageData);
        appendMessage(text, 'me', messageId);

        const chat = allChats.find(c => c.chatId === currentChatId);
        if (chat) {
            chat.lastMessage = text;
            chat.lastTimestamp = Date.now();
            renderChatList();
            saveChatsToLocal();
        }

        socket.emit('chat-message', {
            chatId: currentChatId,
            text,
            messageId,
            fromPin: myPin
        });

        chatInput.value = '';
        chatInput.style.height = 'auto';
        chatInput.focus();
    }

    sendBtn.addEventListener('click', sendMessage);

    chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';

        if (currentChatId && socket) {
            const hasText = this.value.trim().length > 0;
            socket.emit('typing', { chatId: currentChatId, isTyping: hasText, fromPin: myPin });
            if (typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing', { chatId: currentChatId, isTyping: false, fromPin: myPin });
            }, 2000);
        }
    });

    // ===== Leave Chat =====
    leaveBtn.addEventListener('click', function () {
        if (!currentChatId) return;
        if (confirm('Leave this chat?')) {
            allChats = allChats.filter(c => c.chatId !== currentChatId);
            renderChatList();
            saveChatsToLocal();
            currentChatId = null;
            currentPartnerPin = null;
            currentPartnerName = '';
            partnerName.textContent = 'Select a chat';
            partnerPin.textContent = '';
            messageList.innerHTML = '';
        }
    });

    // ===== Search =====
    searchBtn.addEventListener('click', function () {
        searchBar.classList.toggle('show');
        if (searchBar.classList.contains('show')) {
            searchInput.focus();
        } else {
            searchInput.value = '';
            searchResults.classList.remove('show');
        }
    });

    searchCloseBtn.addEventListener('click', function () {
        searchBar.classList.remove('show');
        searchInput.value = '';
        searchResults.classList.remove('show');
    });

    searchInput.addEventListener('input', function () {
        const query = this.value.trim();
        if (!query) {
            searchResults.classList.remove('show');
            return;
        }

        const results = allMessages.filter(msg =>
            msg.type === 'text' && !msg.deleted && msg.text && msg.text.toLowerCase().includes(query.toLowerCase())
        );

        searchResults.innerHTML = '';
        if (results.length === 0) {
            searchResults.innerHTML = '<div class="search-no-results">No messages found</div>';
            searchResults.classList.add('show');
            return;
        }

        results.forEach(msg => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            const highlightedText = msg.text.replace(
                new RegExp(query, 'gi'),
                match => `<span class="highlight">${match}</span>`
            );
            const sender = msg.from === myPin ? 'You' : (currentPartnerName || 'Partner');
            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            item.innerHTML = `
        <div class="result-sender">${sender} · ${time}</div>
        <div>${highlightedText}</div>
      `;
            item.addEventListener('click', function () {
                const wrapper = document.querySelector(`[data-message-id="${msg.id}"]`);
                if (wrapper) {
                    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    wrapper.style.background = 'rgba(79, 70, 229, 0.1)';
                    setTimeout(() => { wrapper.style.background = ''; }, 2000);
                }
                searchBar.classList.remove('show');
                searchResults.classList.remove('show');
                searchInput.value = '';
            });
            searchResults.appendChild(item);
        });
        searchResults.classList.add('show');
    });

    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            searchBar.classList.remove('show');
            searchResults.classList.remove('show');
            searchInput.value = '';
        }
    });

    // ===== Display Message =====
    function displayMessage(msg) {
        if (msg.deleted) {
            appendMessage('This message was deleted', 'other', msg.id, msg.timestamp);
            return;
        }
        const type = msg.from === myPin ? 'me' : 'other';
        if (msg.type === 'image') {
            appendImage(msg.image, type, msg.id, msg.timestamp);
        } else if (msg.type === 'voice') {
            appendVoiceMessage(msg.audioData, msg.duration, type, msg.id, msg.timestamp);
        } else if (msg.type === 'file') {
            appendFileMessage(msg.fileData, msg.fileName, msg.fileSize, type, msg.id, msg.timestamp);
        } else {
            appendMessage(msg.text, type, msg.id, msg.timestamp);
        }
    }

    // ===== Append Text Message =====
    function appendMessage(text, type, messageId = null, timestamp = null) {
        if (!messageList) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        if (messageId) wrapper.dataset.messageId = messageId;

        const div = document.createElement('div');
        div.className = 'message ' + type;
        if (text === 'This message was deleted') {
            div.classList.add('deleted');
        }

        const content = document.createElement('div');
        content.textContent = text;
        div.appendChild(content);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        div.appendChild(time);

        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
    }

    // ===== Append Image Message =====
    function appendImage(imageData, type, messageId = null, timestamp = null) {
        if (!messageList) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        if (messageId) wrapper.dataset.messageId = messageId;

        const div = document.createElement('div');
        div.className = 'message ' + type;

        const img = document.createElement('img');
        img.src = imageData;
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => openImageModal(imageData));
        div.appendChild(img);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        div.appendChild(time);

        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
    }

    // ===== Append Voice Message (FIXED) =====
    function appendVoiceMessage(audioData, duration, type, messageId = null, timestamp = null) {
        if (!messageList) return;

        console.log('📊 Displaying voice message, type:', type, 'duration:', duration);
        console.log('📊 Audio data available:', audioData ? 'yes' : 'no');

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        if (messageId) wrapper.dataset.messageId = messageId;

        const div = document.createElement('div');
        div.className = 'message ' + type;

        // Create audio player
        const audioContainer = document.createElement('div');
        audioContainer.style.display = 'flex';
        audioContainer.style.alignItems = 'center';
        audioContainer.style.gap = '0.5rem';
        audioContainer.style.flexWrap = 'wrap';

        // Play button
        const playBtn = document.createElement('button');
        playBtn.textContent = '▶️';
        playBtn.style.background = 'none';
        playBtn.style.border = 'none';
        playBtn.style.fontSize = '1.5rem';
        playBtn.style.cursor = 'pointer';
        playBtn.style.padding = '0.2rem';
        playBtn.className = 'voice-play-btn';

        // Create audio element
        const audioEl = document.createElement('audio');
        audioEl.style.display = 'none';

        // Check if audioData is valid
        let audioUrl = null;
        if (audioData && typeof audioData === 'string') {
            if (audioData.startsWith('data:audio')) {
                audioUrl = audioData;
            } else if (audioData.startsWith('data:application')) {
                // Some browsers may send as application/octet-stream
                audioUrl = 'data:audio/webm;codecs=opus;base64,' + audioData.split(',')[1] || audioData;
            } else {
                // Assume it's base64 without the data URL prefix
                audioUrl = 'data:audio/webm;codecs=opus;base64,' + audioData;
            }
        }

        if (audioUrl) {
            audioEl.src = audioUrl;
            console.log('✅ Audio URL set successfully');
        } else {
            console.warn('⚠️ Invalid audio data for message:', messageId);
            // Show a fallback
            const fallback = document.createElement('span');
            fallback.textContent = '🎤 Voice message (unavailable)';
            fallback.style.opacity = '0.5';
            fallback.style.fontSize = '0.85rem';
            audioContainer.appendChild(fallback);
            div.appendChild(audioContainer);

            const time = document.createElement('span');
            time.className = 'timestamp';
            if (timestamp) {
                const date = new Date(timestamp);
                time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } else {
                const now = new Date();
                time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            div.appendChild(time);

            wrapper.appendChild(div);
            messageList.appendChild(wrapper);
            scrollToBottom();
            return;
        }

        let isPlaying = false;

        // Toggle play/pause
        playBtn.addEventListener('click', function () {
            if (isPlaying) {
                audioEl.pause();
                this.textContent = '▶️';
                isPlaying = false;
            } else {
                // Stop any other playing audio
                document.querySelectorAll('.message audio').forEach(function (a) {
                    if (a !== audioEl && !a.paused) {
                        a.pause();
                        const btn = a.closest('.message-wrapper')?.querySelector('.voice-play-btn');
                        if (btn) btn.textContent = '▶️';
                    }
                });
                audioEl.play().catch(function (err) {
                    console.error('❌ Play error:', err);
                    playBtn.textContent = '❌';
                    setTimeout(function () {
                        playBtn.textContent = '▶️';
                    }, 2000);
                });
                this.textContent = '⏸️';
                isPlaying = true;
            }
        });

        audioEl.addEventListener('ended', function () {
            playBtn.textContent = '▶️';
            isPlaying = false;
        });

        audioEl.addEventListener('error', function (e) {
            console.error('❌ Audio playback error:', e);
            console.error('❌ Audio URL:', audioEl.src ? 'set' : 'not set');
            playBtn.textContent = '❌';
            setTimeout(function () {
                playBtn.textContent = '▶️';
            }, 2000);
        });

        audioEl.addEventListener('loadedmetadata', function () {
            console.log('✅ Audio loaded, duration:', this.duration);
        });

        // Duration
        const durationSpan = document.createElement('span');
        const mins = Math.floor(duration / 60);
        const secs = Math.floor(duration % 60);
        durationSpan.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        durationSpan.style.fontSize = '0.8rem';
        durationSpan.style.opacity = '0.7';
        durationSpan.style.minWidth = '35px';

        // Progress bar
        const progressBar = document.createElement('input');
        progressBar.type = 'range';
        progressBar.min = 0;
        progressBar.max = 100;
        progressBar.value = 0;
        progressBar.style.flex = '1';
        progressBar.style.minWidth = '60px';
        progressBar.style.maxWidth = '120px';
        progressBar.style.height = '4px';
        progressBar.style.cursor = 'pointer';
        progressBar.style.accentColor = '#4f46e5';

        audioEl.addEventListener('timeupdate', function () {
            if (this.duration) {
                progressBar.value = (this.currentTime / this.duration) * 100;
            }
        });

        progressBar.addEventListener('input', function () {
            if (audioEl.duration) {
                audioEl.currentTime = (this.value / 100) * audioEl.duration;
            }
        });

        audioContainer.appendChild(playBtn);
        audioContainer.appendChild(progressBar);
        audioContainer.appendChild(durationSpan);
        audioContainer.appendChild(audioEl);

        div.appendChild(audioContainer);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        div.appendChild(time);

        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
    }

    // ===== Append File Message =====
    function appendFileMessage(fileData, fileName, fileSize, type, messageId = null, timestamp = null) {
        if (!messageList) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        if (messageId) wrapper.dataset.messageId = messageId;

        const div = document.createElement('div');
        div.className = 'message ' + type;

        const icon = document.createElement('span');
        icon.textContent = '📄';
        icon.style.fontSize = '1.5rem';
        icon.style.marginRight = '0.5rem';
        div.appendChild(icon);

        const info = document.createElement('span');
        info.textContent = `${fileName} (${fileSize})`;
        info.style.fontSize = '0.85rem';
        div.appendChild(info);

        const downloadBtn = document.createElement('button');
        downloadBtn.textContent = '⬇️';
        downloadBtn.style.background = 'none';
        downloadBtn.style.border = 'none';
        downloadBtn.style.fontSize = '1.2rem';
        downloadBtn.style.cursor = 'pointer';
        downloadBtn.style.marginLeft = '0.5rem';
        downloadBtn.addEventListener('click', () => {
            const link = document.createElement('a');
            link.href = fileData;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
        div.appendChild(downloadBtn);

        const time = document.createElement('span');
        time.className = 'timestamp';
        if (timestamp) {
            const date = new Date(timestamp);
            time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            const now = new Date();
            time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        div.appendChild(time);

        wrapper.appendChild(div);
        messageList.appendChild(wrapper);
        scrollToBottom();
    }

    function scrollToBottom() {
        if (messageList) {
            messageList.scrollTop = messageList.scrollHeight;
        }
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
            setTimeout(() => { oscillator.stop(); }, 150);
        } catch (e) {
            console.log('Sound not supported');
        }
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

    function playVoiceMessage(audioData) {
        const modal = document.getElementById('audioPlayerModal');
        const audioPlayer = document.getElementById('audioPlayer');
        audioPlayer.src = audioData;
        modal.classList.add('show');
        audioPlayer.play();
    }

    // ===== Image Sharing =====
    imageBtn.addEventListener('click', function () {
        imageInput.click();
    });

    imageInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            const imageData = event.target.result;
            const messageId = Date.now() + '_img';

            const messageData = {
                id: messageId,
                image: imageData,
                fileName: file.name,
                from: myPin,
                timestamp: Date.now(),
                type: 'image',
                deleted: false
            };

            allMessages.push(messageData);
            appendImage(imageData, 'me', messageId);

            const chat = allChats.find(c => c.chatId === currentChatId);
            if (chat) {
                chat.lastMessage = '📸 Image';
                chat.lastTimestamp = Date.now();
                renderChatList();
                saveChatsToLocal();
            }

            socket.emit('chat-image', {
                chatId: currentChatId,
                image: imageData,
                fileName: file.name,
                messageId: messageId,
                fromPin: myPin
            });

            imageInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    // ===== File Sharing =====
    fileBtn.addEventListener('click', function () {
        fileInput.click();
    });

    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
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
                from: myPin,
                timestamp: Date.now(),
                type: 'file',
                deleted: false
            };

            allMessages.push(messageData);
            appendFileMessage(fileData, file.name, fileSize, 'me', messageId);

            const chat = allChats.find(c => c.chatId === currentChatId);
            if (chat) {
                chat.lastMessage = `📄 ${file.name}`;
                chat.lastTimestamp = Date.now();
                renderChatList();
                saveChatsToLocal();
            }

            socket.emit('chat-file', {
                chatId: currentChatId,
                fileData: fileData,
                fileName: file.name,
                fileType: file.type,
                fileSize: fileSize,
                messageId: messageId,
                fromPin: myPin
            });

            fileInput.value = '';
        };
        reader.readAsDataURL(file);
    });

    // ===== Voice Recording (FIXED) =====
    voiceBtn.addEventListener('click', function () {
        if (!currentChatId) {
            setError('Please select a chat first');
            return;
        }

        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    function startRecording() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm;codecs=opus'
                });
                audioChunks = [];
                recordingSeconds = 0;
                isRecording = true;

                voiceBtn.classList.add('recording');
                const voiceModal = document.getElementById('voiceModal');
                voiceModal.classList.add('show');

                if (recordingTimer) clearInterval(recordingTimer);
                recordingTimer = setInterval(function () {
                    recordingSeconds++;
                    const mins = Math.floor(recordingSeconds / 60);
                    const secs = recordingSeconds % 60;
                    const timer = document.getElementById('voiceTimer');
                    if (timer) timer.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                }, 1000);

                mediaRecorder.ondataavailable = function (event) {
                    if (event.data.size > 0) {
                        audioChunks.push(event.data);
                    }
                };

                mediaRecorder.onstop = function () {
                    console.log('🎤 Recording stopped, chunks:', audioChunks.length);

                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
                    console.log('📊 Audio blob size:', audioBlob.size, 'bytes');

                    const reader = new FileReader();
                    reader.onload = function () {
                        const audioData = reader.result;
                        console.log('📊 Audio data length:', audioData ? audioData.length : 'null');

                        const messageId = Date.now() + '_voice';

                        const messageData = {
                            id: messageId,
                            audioData: audioData,
                            duration: recordingSeconds,
                            from: myPin,
                            timestamp: Date.now(),
                            type: 'voice',
                            deleted: false
                        };

                        allMessages.push(messageData);
                        appendVoiceMessage(audioData, recordingSeconds, 'me', messageId);

                        const chat = allChats.find(c => c.chatId === currentChatId);
                        if (chat) {
                            chat.lastMessage = '🎤 Voice';
                            chat.lastTimestamp = Date.now();
                            renderChatList();
                            saveChatsToLocal();
                        }

                        console.log('📤 Sending voice message to server...');
                        socket.emit('voice-message', {
                            chatId: currentChatId,
                            audioData: audioData,
                            duration: recordingSeconds,
                            messageId: messageId,
                            fromPin: myPin
                        });

                        const voiceModal = document.getElementById('voiceModal');
                        voiceModal.classList.remove('show');
                        voiceBtn.classList.remove('recording');
                    };

                    reader.onerror = function (err) {
                        console.error('❌ Error reading audio blob:', err);
                        alert('Error processing voice message. Please try again.');
                    };

                    reader.readAsDataURL(audioBlob);

                    stream.getTracks().forEach(function (track) { track.stop(); });
                    isRecording = false;
                    if (recordingTimer) {
                        clearInterval(recordingTimer);
                        recordingTimer = null;
                    }
                };

                mediaRecorder.start(100);
            })
            .catch(function (err) {
                console.error('❌ Microphone error:', err);
                alert('Microphone access is required for voice messages.');
            });
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            console.log('⏹️ Stopping recording...');
            mediaRecorder.stop();
        }
    }

    // ===== Emoji Picker =====
    emojiBtn.addEventListener('click', function () {
        emojiPicker.classList.toggle('show');
    });

    emojiPicker.querySelectorAll('button').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const emoji = this.textContent;
            const cursorPos = chatInput.selectionStart;
            const text = chatInput.value;
            chatInput.value = text.slice(0, cursorPos) + emoji + text.slice(cursorPos);
            chatInput.focus();
            chatInput.selectionStart = chatInput.selectionEnd = cursorPos + emoji.length;
            emojiPicker.classList.remove('show');
            chatInput.dispatchEvent(new Event('input'));
        });
    });

    document.addEventListener('click', function (e) {
        if (emojiPicker && emojiBtn && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
            emojiPicker.classList.remove('show');
        }
    });

    // ===== Image Modal Close =====
    document.getElementById('closeModal').addEventListener('click', function () {
        document.getElementById('imageModal').classList.remove('show');
    });

    document.getElementById('imageModal').addEventListener('click', function (e) {
        if (e.target === this) {
            this.classList.remove('show');
        }
    });

    document.getElementById('closeAudioBtn').addEventListener('click', function () {
        document.getElementById('audioPlayerModal').classList.remove('show');
        const audioPlayer = document.getElementById('audioPlayer');
        if (audioPlayer) audioPlayer.pause();
    });

    // ===== Quick Replies =====
    document.querySelectorAll('.quick-reply').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const text = this.dataset.text;
            chatInput.value = text;
            sendMessage();
        });
    });

    // ===== Dark Mode =====
    if (darkModeToggle) {
        if (localStorage.getItem('darkMode') === 'enabled') {
            document.body.classList.add('dark-mode');
            darkModeToggle.textContent = '☀️';
        }
        darkModeToggle.addEventListener('click', function () {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            this.textContent = isDark ? '☀️' : '🌙';
            localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
        });
    }

    // ===== Keyboard Shortcuts =====
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            document.getElementById('imageModal').classList.remove('show');
            document.getElementById('audioPlayerModal').classList.remove('show');
            const audioPlayer = document.getElementById('audioPlayer');
            if (audioPlayer) audioPlayer.pause();
            searchBar.classList.remove('show');
            searchResults.classList.remove('show');
            searchInput.value = '';
            emojiPicker.classList.remove('show');
        }
    });

    // ===== Phone Input Formatting =====
    phoneInput.addEventListener('input', function () {
        const cleaned = this.value.replace(/\D/g, '');
        if (cleaned.length > 0) {
            let formatted = '+' + cleaned;
            if (cleaned.length > 3) formatted = '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3);
            if (cleaned.length > 6) formatted = '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6);
            if (cleaned.length > 10) formatted = '+' + cleaned.slice(0, 3) + ' ' + cleaned.slice(3, 6) + ' ' + cleaned.slice(6, 10);
            this.value = formatted;
        }
    });

    // ===== Initialize =====
    console.log('✅ Quickie app initialized!');
    loginPinInput.focus();

    connectSocket();

})();