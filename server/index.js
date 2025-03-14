const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../public')));

// Store active users and available rooms
let users = {};
let rooms = {
  'General': { users: {}, messages: [] },
  'Technology': { users: {}, messages: [] },
  'Random': { users: {}, messages: [] }
};

// User accounts - in a real app, this would be in a database
let userAccounts = {};

// Check if username is taken across all rooms
function isUsernameTakenGlobally(username, currentSocketId = null) {
  // Loop through all rooms to check
  for (let roomName in rooms) {
    let roomUsers = Object.values(rooms[roomName].users);
    // If we find the username and it's not the current user, it's taken
    if (roomUsers.some(user => user.username === username && user.id !== currentSocketId)) {
      return true;
    }
  }
  return false;
}

// Check if email is already registered
function isEmailRegistered(email, currentSocketId = null) {
  return Object.values(userAccounts).some(account => 
    account.email === email && account.socketId !== currentSocketId
  );
}

// Format HTML in messages - only allow certain tags
function formatMessageHTML(text) {
  // Only allow these tags - everything else gets escaped
  const okTags = ['b', 'i', 'a'];
  
  // Match all HTML tags
  const tagPattern = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
  
  return text.replace(tagPattern, (match, tag) => {
    // If it's in our allowed list, keep it
    if (okTags.includes(tag.toLowerCase())) {
      // For links, make sure they open in new tab and are secure
      if (tag.toLowerCase() === 'a') {
        // Get the href
        const hrefMatch = match.match(/href=["']([^"']*)["']/i);
        const href = hrefMatch ? hrefMatch[1] : '#';
        
        // If opening tag, add safety stuff
        if (!match.startsWith('</')) {
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
        }
      }
      return match;
    }
    // Otherwise, escape it so it shows as text not HTML
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

// Save message in room history
function storeMessageInRoom(roomName, message) {
  if (rooms[roomName]) {
    // Keep only the last 100 messages to avoid memory issues
    if (rooms[roomName].messages.length >= 100) {
      // Remove oldest message
      rooms[roomName].messages.shift();
    }
    rooms[roomName].messages.push(message);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // Handle user registration
  socket.on('register_user', ({ username, email }) => {
    // Clean up inputs
    let cleanUsername = username ? username.trim().substring(0, 20) : '';
    let cleanEmail = email ? email.trim().toLowerCase() : '';
    
    if (!cleanUsername || !cleanEmail) {
      socket.emit('error', 'Username and email are required');
      return;
    }
    
    // Make sure email looks valid
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      socket.emit('error', 'Please enter a valid email address');
      return;
    }
    
    // Check if username is already taken
    if (isUsernameTakenGlobally(cleanUsername)) {
      socket.emit('username_taken');
      return;
    }
    
    // Check if email is already registered
    if (isEmailRegistered(cleanEmail)) {
      socket.emit('email_taken');
      return;
    }
    
    // Register the user
    userAccounts[socket.id] = {
      username: cleanUsername,
      email: cleanEmail,
      socketId: socket.id,
      registeredAt: new Date()
    };
    
    // Let them know it worked
    socket.emit('registration_success', { username: cleanUsername, email: cleanEmail });
  });

  // Handle reconnection with saved session
  socket.on('reconnect_session', ({ username, email, room }) => {
    // Clean up inputs
    let cleanUsername = username ? username.trim().substring(0, 20) : '';
    let cleanEmail = email ? email.trim().toLowerCase() : '';
    let cleanRoom = room ? room.trim() : '';
    
    // Check required fields
    if (!cleanUsername) {
      socket.emit('error', 'Username is required');
      return;
    }
    
    if (!cleanEmail) {
      socket.emit('error', 'Email is required');
      return;
    }
    
    if (!cleanRoom) {
      socket.emit('error', 'Room is required');
      return;
    }
    
    // Make sure room still exists
    if (!rooms[cleanRoom]) {
      socket.emit('error', 'Room no longer exists');
      return;
    }
    
    // Check if username is taken by someone else
    if (isUsernameTakenGlobally(cleanUsername, socket.id)) {
      socket.emit('username_taken');
      return;
    }
    
    // Check if email is registered by someone else
    if (isEmailRegistered(cleanEmail, socket.id)) {
      socket.emit('email_taken');
      return;
    }
    
    // Update or create user account
    userAccounts[socket.id] = {
      username: cleanUsername,
      email: cleanEmail,
      socketId: socket.id,
      registeredAt: new Date()
    };
    
    // Store user info
    users[socket.id] = { username: cleanUsername, email: cleanEmail, room: cleanRoom };
    
    // Add user to room
    rooms[cleanRoom].users[socket.id] = { username: cleanUsername, id: socket.id };
    
    // Join the room
    socket.join(cleanRoom);
    
    // Let them know they're in
    socket.emit('join_success', { 
      room: cleanRoom, 
      username: cleanUsername,
      messages: rooms[cleanRoom].messages // Send message history
    });
    
    // Update room users list
    io.to(cleanRoom).emit('room_users', {
      room: cleanRoom,
      users: Object.values(rooms[cleanRoom].users)
    });
    
    // Send available rooms to everyone
    io.emit('available_rooms', Object.keys(rooms));
    
    // Welcome back message
    let welcomeBackMessage = {
      user: 'System',
      text: `Welcome back to the ${cleanRoom} room, ${cleanUsername}!`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.emit('message', welcomeBackMessage);
    
    // Tell others this person rejoined
    let userJoinedMessage = {
      user: 'System',
      text: `${cleanUsername} has rejoined the room`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.to(cleanRoom).emit('message', userJoinedMessage);
    
    // Save system messages
    storeMessageInRoom(cleanRoom, welcomeBackMessage);
    storeMessageInRoom(cleanRoom, userJoinedMessage);
  });

  // Handle user joining with username
  socket.on('join', ({ username, email, room }) => {
    // Clean up inputs
    let cleanUsername = username ? username.trim().substring(0, 20) : '';
    let cleanEmail = email ? email.trim().toLowerCase() : '';
    let cleanRoom = room ? room.trim() : '';
    
    // Check required fields
    if (!cleanUsername) {
      socket.emit('error', 'Username is required');
      return;
    }
    
    if (!cleanEmail) {
      socket.emit('error', 'Email is required');
      return;
    }
    
    if (!cleanRoom) {
      socket.emit('error', 'Room is required');
      return;
    }
    
    // Check if username is taken
    if (isUsernameTakenGlobally(cleanUsername, socket.id)) {
      socket.emit('username_taken');
      return;
    }
    
    // Check if email is registered
    if (isEmailRegistered(cleanEmail, socket.id)) {
      socket.emit('email_taken');
      return;
    }
    
    // Update or create user account
    userAccounts[socket.id] = {
      username: cleanUsername,
      email: cleanEmail,
      socketId: socket.id,
      registeredAt: new Date()
    };

    // If user was in another room, leave it first
    if (users[socket.id] && users[socket.id].room) {
      let oldRoom = users[socket.id].room;
      
      // Leave the old room
      socket.leave(oldRoom);
      
      // Remove user from old room
      if (rooms[oldRoom] && rooms[oldRoom].users[socket.id]) {
        delete rooms[oldRoom].users[socket.id];
        
        // Tell old room that user left
        let leftMessage = {
          user: 'System',
          text: `${cleanUsername} has left the room`,
          time: new Date().toLocaleTimeString()
        };
        
        io.to(oldRoom).emit('message', leftMessage);
        storeMessageInRoom(oldRoom, leftMessage);
        
        // Update user list in old room
        io.to(oldRoom).emit('room_users', {
          room: oldRoom,
          users: Object.values(rooms[oldRoom].users)
        });
      }
    }
    
    // Store user info
    users[socket.id] = { username: cleanUsername, email: cleanEmail, room: cleanRoom };
    
    // Create room if it doesn't exist
    if (!rooms[cleanRoom]) {
      rooms[cleanRoom] = { users: {}, messages: [] };
    }
    
    // Add user to room
    rooms[cleanRoom].users[socket.id] = { username: cleanUsername, id: socket.id };
    
    // Join the room
    socket.join(cleanRoom);
    
    // Let them know they're in
    socket.emit('join_success', { 
      room: cleanRoom, 
      username: cleanUsername,
      messages: rooms[cleanRoom].messages // Send message history
    });
    
    // Update room users list
    io.to(cleanRoom).emit('room_users', {
      room: cleanRoom,
      users: Object.values(rooms[cleanRoom].users)
    });
    
    // Send available rooms to everyone
    io.emit('available_rooms', Object.keys(rooms));
    
    // Welcome message
    let welcomeMessage = {
      user: 'System',
      text: `Welcome to the ${cleanRoom} room, ${cleanUsername}!`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.emit('message', welcomeMessage);
    
    // Tell others this person joined
    let joinedMessage = {
      user: 'System',
      text: `${cleanUsername} has joined the room`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.to(cleanRoom).emit('message', joinedMessage);
    
    // Save system messages
    storeMessageInRoom(cleanRoom, welcomeMessage);
    storeMessageInRoom(cleanRoom, joinedMessage);
  });

  // Handle creating a new room
  socket.on('create_room', (roomName) => {
    // Clean up room name
    let cleanRoomName = roomName ? roomName.trim().substring(0, 30) : '';
    
    if (!cleanRoomName) {
      socket.emit('error', 'Room name is required');
      return;
    }
    
    // Create room if it doesn't exist
    if (!rooms[cleanRoomName]) {
      rooms[cleanRoomName] = { users: {}, messages: [] };
      io.emit('available_rooms', Object.keys(rooms));
      socket.emit('room_created', cleanRoomName);
    } else {
      socket.emit('room_exists');
    }
  });

  // Handle switching rooms
  socket.on('switch_room', (newRoom) => {
    let user = users[socket.id];
    
    if (!user) {
      socket.emit('error', 'You must be logged in to switch rooms');
      return;
    }
    
    let oldRoom = user.room;
    let cleanNewRoom = newRoom ? newRoom.trim() : '';
    
    if (!cleanNewRoom) {
      socket.emit('error', 'Invalid room name');
      return;
    }
    
    // No need to switch if already in this room
    if (oldRoom === cleanNewRoom) {
      return;
    }
    
    if (!rooms[cleanNewRoom]) {
      socket.emit('error', 'Room does not exist');
      return;
    }
    
    // Leave the old room
    socket.leave(oldRoom);
    
    // Remove user from old room
    if (rooms[oldRoom] && rooms[oldRoom].users[socket.id]) {
      delete rooms[oldRoom].users[socket.id];
      
      // Tell old room that user left
      let leftMessage = {
        user: 'System',
        text: `${user.username} has left the room`,
        time: new Date().toLocaleTimeString()
      };
      
      io.to(oldRoom).emit('message', leftMessage);
      storeMessageInRoom(oldRoom, leftMessage);
      
      // Update user list in old room
      io.to(oldRoom).emit('room_users', {
        room: oldRoom,
        users: Object.values(rooms[oldRoom].users)
      });
    }
    
    // Update user's room
    user.room = cleanNewRoom;
    
    // Add user to new room
    rooms[cleanNewRoom].users[socket.id] = { username: user.username, id: socket.id };
    
    // Join the new room
    socket.join(cleanNewRoom);
    
    // Let them know they're in
    socket.emit('join_success', { 
      room: cleanNewRoom, 
      username: user.username,
      messages: rooms[cleanNewRoom].messages // Send message history
    });
    
    // Update room users list
    io.to(cleanNewRoom).emit('room_users', {
      room: cleanNewRoom,
      users: Object.values(rooms[cleanNewRoom].users)
    });
    
    // Welcome message
    let switchMessage = {
      user: 'System',
      text: `Welcome to the ${cleanNewRoom} room, ${user.username}!`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.emit('message', switchMessage);
    
    // Tell others this person joined
    let joinedMessage = {
      user: 'System',
      text: `${user.username} has joined the room`,
      time: new Date().toLocaleTimeString()
    };
    
    socket.to(cleanNewRoom).emit('message', joinedMessage);
    
    // Save system messages
    storeMessageInRoom(cleanNewRoom, switchMessage);
    storeMessageInRoom(cleanNewRoom, joinedMessage);
  });

  // Handle sending messages
  socket.on('send_message', (message) => {
    let user = users[socket.id];
    if (user && user.room) {
      // Make sure message isn't empty
      if (!message) {
        return;
      }
      
      // Format message to allow only safe HTML
      let formattedMessage = formatMessageHTML(message);
      
      let messageObj = {
        user: user.username,
        text: formattedMessage,
        time: new Date().toLocaleTimeString()
      };
      
      // Send to everyone in the room
      io.to(user.room).emit('message', messageObj);
      
      // Save message in room history
      storeMessageInRoom(user.room, messageObj);
    }
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    let user = users[socket.id];
    if (user) {
      let { username, room } = user;
      
      // Remove user from room
      if (rooms[room] && rooms[room].users[socket.id]) {
        delete rooms[room].users[socket.id];
        
        // If room is empty and not a default room, remove it
        let defaultRooms = ['General', 'Technology', 'Random'];
        if (Object.keys(rooms[room].users).length === 0 && !defaultRooms.includes(room)) {
          delete rooms[room];
          io.emit('available_rooms', Object.keys(rooms));
        } else {
          // Update room users list
          io.to(room).emit('room_users', {
            room,
            users: Object.values(rooms[room].users)
          });
          
          // Tell room that user left
          let leftMessage = {
            user: 'System',
            text: `${username} has left the room`,
            time: new Date().toLocaleTimeString()
          };
          
          io.to(room).emit('message', leftMessage);
          storeMessageInRoom(room, leftMessage);
        }
      }
      
      // Remove user from users list
      delete users[socket.id];
    }
    
    // Remove user account
    delete userAccounts[socket.id];
    
    console.log('User disconnected:', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

// Handle port in use error
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Trying port ${PORT + 1}...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT + 1);
    }, 1000);
  } else {
    console.error('Server error:', error);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${server.address().port}`);
}); 