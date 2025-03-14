// Connect to Socket.io server
const socket = io();

// DOM Elements - grab everything we need
let loginScreen = document.getElementById('login-screen');
let chatScreen = document.getElementById('chat-screen');
let loadingScreen = document.getElementById('loading-screen');
let usernameInput = document.getElementById('username');
let emailInput = document.getElementById('email');
let roomSelect = document.getElementById('room-select');
let newRoomInput = document.getElementById('new-room');
let createRoomBtn = document.getElementById('create-room-btn');
let joinBtn = document.getElementById('join-btn');
let loginError = document.getElementById('login-error');
let currentRoomElement = document.getElementById('current-room');
let leaveBtn = document.getElementById('leave-btn');
let roomsList = document.getElementById('rooms');
let usersList = document.getElementById('users');
let messagesContainer = document.getElementById('messages');
let chatForm = document.getElementById('chat-form');
let messageInput = document.getElementById('msg');
let usernameDisplay = document.getElementById('username-display');
let userInfoDisplay = document.getElementById('user-info-display');
let emailDisplay = document.getElementById('email-display');
let formatButtons = document.querySelectorAll('.format-btn');

// Variables to keep track of state
let currentUsername = '';
let currentEmail = '';
let currentRoom = '';
let availableRooms = [];
let roomMessages = {}; // Store messages by room

// Initialize the application
function init() {
    // Clear any previous error messages
    loginError.textContent = '';
    
    // Check if there's a saved session
    let savedSession = getSavedSession();
    
    if (savedSession) {
        // Try to reconnect with saved session
        attemptReconnect(savedSession);
    } else {
        // Show login screen if no saved session
        showLoginScreen();
    }
    
    // Get available rooms from server
    socket.on('available_rooms', (rooms) => {
        availableRooms = rooms;
        updateRoomsList();
    });
    
    // Setup event listeners
    setupEventListeners();
    
    // Save messages when user leaves
    window.addEventListener('beforeunload', () => {
        if (currentUsername && currentRoom) {
            saveMessages();
        }
    });
}

// Show login screen
function showLoginScreen() {
    hideAllScreens();
    loginScreen.classList.remove('hidden');
}

// Show chat screen
function showChatScreen() {
    hideAllScreens();
    chatScreen.classList.remove('hidden');
    
    // Update UI elements
    currentRoomElement.textContent = currentRoom;
    usernameDisplay.textContent = currentUsername;
    userInfoDisplay.textContent = currentUsername;
    emailDisplay.textContent = currentEmail;
    
    // Focus on message input
    messageInput.focus();
}

// Show loading screen
function showLoadingScreen() {
    hideAllScreens();
    loadingScreen.classList.remove('hidden');
}

// Hide all screens
function hideAllScreens() {
    loginScreen.classList.add('hidden');
    chatScreen.classList.add('hidden');
    loadingScreen.classList.add('hidden');
}

// Try to reconnect with saved session
function attemptReconnect(session) {
    // Show loading screen while we try to reconnect
    showLoadingScreen();
    
    // Make sure we have all the data we need
    if (!session.username || !session.email || !session.room) {
        showLoginScreen();
        showError('Incomplete session data. Please log in again.');
        clearSession();
        return;
    }
    
    // Try to reconnect
    socket.emit('reconnect_session', {
        username: session.username,
        email: session.email,
        room: session.room
    });
    
    // Set a timeout in case reconnection takes too long
    setTimeout(() => {
        if (!loadingScreen.classList.contains('hidden')) {
            showLoginScreen();
            showError('Reconnection timed out. Please log in again.');
            clearSession();
        }
    }, 10000); // 10 seconds timeout
}

// Save session data to localStorage
function saveSession() {
    if (currentUsername && currentEmail && currentRoom) {
        let sessionData = {
            username: currentUsername,
            email: currentEmail,
            room: currentRoom,
            timestamp: new Date().getTime()
        };
        localStorage.setItem('chatSession', JSON.stringify(sessionData));
    }
}

// Save messages to localStorage
function saveMessages() {
    if (Object.keys(roomMessages).length > 0) {
        let sessionData = JSON.parse(localStorage.getItem('chatSession') || '{}');
        sessionData.roomMessages = roomMessages;
        localStorage.setItem('chatSession', JSON.stringify(sessionData));
    }
}

// Get saved session from localStorage
function getSavedSession() {
    let sessionData = localStorage.getItem('chatSession');
    if (!sessionData) return null;
    
    try {
        let session = JSON.parse(sessionData);
        
        // Check if session is still valid (less than 24 hours old)
        let now = new Date().getTime();
        let sessionAge = now - (session.timestamp || 0);
        let maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (sessionAge > maxAge) {
            // Session expired, clear it
            localStorage.removeItem('chatSession');
            return null;
        }
        
        // Load saved room messages if available
        if (session.roomMessages) {
            roomMessages = session.roomMessages;
        }
        
        return session;
    } catch (error) {
        console.error('Error parsing saved session:', error);
        localStorage.removeItem('chatSession');
        return null;
    }
}

// Clear saved session
function clearSession() {
    localStorage.removeItem('chatSession');
    currentUsername = '';
    currentEmail = '';
    currentRoom = '';
    roomMessages = {};
}

// Setup all event listeners
function setupEventListeners() {
    // Join button click
    joinBtn.addEventListener('click', joinRoom);
    
    // Create room button click
    createRoomBtn.addEventListener('click', createRoom);
    
    // Leave button click
    leaveBtn.addEventListener('click', leaveRoom);
    
    // Chat form submit
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });
    
    // Also handle send button click for better compatibility
    document.querySelector('.send-btn').addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage();
    });
    
    // Handle Enter key in username input to move to email input
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            emailInput.focus();
        }
    });
    
    // Handle Enter key in email input to move to room select
    emailInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            roomSelect.focus();
        }
    });
    
    // Handle Enter key in new room input to create room
    newRoomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            createRoom();
        }
    });
    
    // Format buttons click
    formatButtons.forEach(button => {
        button.addEventListener('click', () => {
            applyFormatting(button.dataset.format);
        });
    });
    
    // Socket event listeners
    setupSocketListeners();
}

// Setup Socket.io event listeners
function setupSocketListeners() {
    // Handle username taken error
    socket.on('username_taken', () => {
        showLoginScreen();
        loginError.textContent = 'Username is already taken. Please choose another.';
        usernameInput.focus();
    });
    
    // Handle email taken error
    socket.on('email_taken', () => {
        showLoginScreen();
        loginError.textContent = 'Email is already registered. Please use another email.';
        emailInput.focus();
    });
    
    // Handle registration success
    socket.on('registration_success', ({ username, email }) => {
        currentUsername = username;
        currentEmail = email;
        
        // Join the selected room after successful registration
        let room = roomSelect.value;
        socket.emit('join', { username, email, room });
    });
    
    // Handle successful join
    socket.on('join_success', ({ room, username, messages = [] }) => {
        currentUsername = username;
        currentRoom = room;
        
        // Save session data
        saveSession();
        
        // Clear messages container
        messagesContainer.innerHTML = '';
        
        // Store room messages
        if (!roomMessages[room]) {
            roomMessages[room] = [];
        }
        
        // Update room messages with server data
        roomMessages[room] = messages;
        
        // Display room messages
        if (messages.length > 0) {
            messages.forEach(message => {
                displayMessage(message, false);
            });
            
            // Scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
        
        // Show chat screen
        showChatScreen();
        
        // Update active room in the sidebar
        updateActiveRoom(room);
    });
    
    // Handle room created
    socket.on('room_created', (roomName) => {
        roomSelect.innerHTML += `<option value="${roomName}">${roomName}</option>`;
        roomSelect.value = roomName;
        loginError.textContent = `Room "${roomName}" created! You can now join it.`;
    });
    
    // Handle room exists error
    socket.on('room_exists', () => {
        loginError.textContent = 'Room already exists. Please choose another name.';
        newRoomInput.focus();
    });
    
    // Handle general errors
    socket.on('error', (message) => {
        showLoginScreen();
        loginError.textContent = message;
        
        // Focus on the appropriate input based on the error message
        if (message.includes('Username')) {
            usernameInput.focus();
        } else if (message.includes('Email')) {
            emailInput.focus();
        } else if (message.includes('Room')) {
            roomSelect.focus();
        }
    });
    
    // Handle connection errors
    socket.on('connect_error', () => {
        showError('Connection error. Please check your internet connection and try again.');
        showLoginScreen();
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        if (currentRoom) {
            showError('You have been disconnected from the server. We will try to reconnect you automatically.');
        }
    });
    
    // Handle reconnection
    socket.on('connect', () => {
        if (currentUsername && currentEmail && currentRoom) {
            // If we were in a room before, try to rejoin
            socket.emit('reconnect_session', {
                username: currentUsername,
                email: currentEmail,
                room: currentRoom
            });
        }
    });
    
    // Handle room users update
    socket.on('room_users', ({ room, users }) => {
        updateRoomInfo(room);
        updateUsersList(users);
    });
    
    // Handle incoming messages
    socket.on('message', (message) => {
        // Store message in memory for current room
        if (!roomMessages[currentRoom]) {
            roomMessages[currentRoom] = [];
        }
        roomMessages[currentRoom].push(message);
        
        // Display the message
        displayMessage(message, true);
    });
}

// Show error message
function showError(message) {
    let errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    // Remove after 5 seconds
    setTimeout(() => {
        errorDiv.classList.add('fade-out');
        setTimeout(() => {
            if (errorDiv.parentNode) {
                document.body.removeChild(errorDiv);
            }
        }, 500);
    }, 5000);
}

// Join a chat room
function joinRoom() {
    // Clear any previous error messages
    loginError.textContent = '';
    
    let username = usernameInput.value.trim();
    let email = emailInput.value.trim();
    let room = roomSelect.value;
    
    // Validate username
    if (!username) {
        loginError.textContent = 'Please enter a username';
        usernameInput.focus();
        return;
    }
    
    // Validate email
    if (!email) {
        loginError.textContent = 'Please enter an email address';
        emailInput.focus();
        return;
    }
    
    // Validate email format
    let emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        loginError.textContent = 'Please enter a valid email address';
        emailInput.focus();
        return;
    }
    
    // Store current values
    currentUsername = username;
    currentEmail = email;
    currentRoom = room;
    
    // Emit join event to server
    socket.emit('join', { username, email, room });
}

// Create a new chat room
function createRoom() {
    // Clear any previous error messages
    loginError.textContent = '';
    
    let roomName = newRoomInput.value.trim();
    
    if (!roomName) {
        loginError.textContent = 'Please enter a room name';
        newRoomInput.focus();
        return;
    }
    
    // Emit create room event to server
    socket.emit('create_room', roomName);
    newRoomInput.value = '';
}

// Leave the current room
function leaveRoom() {
    // Clear session data
    clearSession();
    
    // Reload the page to disconnect and return to login screen
    window.location.reload();
}

// Switch to a different room
function switchRoom(roomName) {
    if (roomName === currentRoom) return; // Already in this room
    
    // Emit switch room event to server
    socket.emit('switch_room', roomName);
}

// Send a message
function sendMessage() {
    let msg = messageInput.value.trim();
    
    if (!msg) {
        return;
    }
    
    // Emit message to server
    socket.emit('send_message', msg);
    
    // Clear input
    messageInput.value = '';
    messageInput.focus();
}

// Apply text formatting
function applyFormatting(format) {
    let input = messageInput;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    let selectedText = input.value.substring(start, end);
    let formattedText = '';
    
    switch (format) {
        case 'bold':
            formattedText = `<b>${selectedText}</b>`;
            break;
        case 'italic':
            formattedText = `<i>${selectedText}</i>`;
            break;
        case 'link':
            let url = prompt('Enter URL:', 'https://');
            if (url) {
                formattedText = `<a href="${url}" target="_blank">${selectedText || url}</a>`;
            } else {
                return;
            }
            break;
    }
    
    // Insert formatted text
    if (formattedText) {
        input.value = input.value.substring(0, start) + formattedText + input.value.substring(end);
        input.focus();
        input.selectionStart = start + formattedText.length;
        input.selectionEnd = start + formattedText.length;
    }
}

// Display a message in the chat
function displayMessage(message, shouldScroll = true) {
    let { user, text, time } = message;
    
    // Create message element
    let div = document.createElement('div');
    
    // Determine message type
    if (user === 'System') {
        div.className = 'message system';
    } else if (user === currentUsername) {
        div.className = 'message outgoing';
    } else {
        div.className = 'message incoming';
    }
    
    // Create message header
    let headerDiv = document.createElement('div');
    headerDiv.className = 'message-header';
    
    // Create username element with proper styling
    let usernameSpan = document.createElement('span');
    usernameSpan.className = 'username';
    usernameSpan.textContent = user;
    
    // Create time element with proper styling
    let timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = time;
    
    // Add elements to header
    headerDiv.appendChild(usernameSpan);
    headerDiv.appendChild(timeSpan);
    
    // Create message text
    let textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = text; // Use innerHTML to render HTML formatting
    
    // Append elements to message div
    div.appendChild(headerDiv);
    div.appendChild(textDiv);
    
    // Add message to DOM
    messagesContainer.appendChild(div);
    
    // Scroll to bottom if needed
    if (shouldScroll) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Update the rooms list
function updateRoomsList() {
    roomsList.innerHTML = '';
    
    availableRooms.forEach(room => {
        let li = document.createElement('li');
        li.textContent = room;
        li.dataset.room = room;
        
        if (room === currentRoom) {
            li.classList.add('active');
        }
        
        // Add click event to switch rooms
        li.addEventListener('click', () => {
            switchRoom(room);
        });
        
        roomsList.appendChild(li);
    });
}

// Update active room in the sidebar
function updateActiveRoom(roomName) {
    // Remove active class from all room items
    let roomItems = roomsList.querySelectorAll('li');
    roomItems.forEach(item => {
        item.classList.remove('active');
        if (item.dataset.room === roomName) {
            item.classList.add('active');
        }
    });
}

// Update the users list
function updateUsersList(users) {
    usersList.innerHTML = '';
    
    users.forEach(user => {
        let li = document.createElement('li');
        li.textContent = user.username;
        
        if (user.username === currentUsername) {
            li.innerHTML += ' (You)';
            li.style.fontWeight = 'bold';
        }
        
        usersList.appendChild(li);
    });
}

// Update room information
function updateRoomInfo(room) {
    currentRoomElement.textContent = room;
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', init); 