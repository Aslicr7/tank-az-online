/**
 * Tank AZ Online - Standalone Express & Socket.IO Server (CommonJS, Node.js 14 compatible)
 * Run directly using: node server.js
 */

var express = require('express');
var http = require('http');
var path = require('path');
var os = require('os');
var fs = require('fs');
var { Server } = require('socket.io');
var { GameRoom } = require('./server/room.js');

var app = express();
var httpServer = http.createServer(app);
var io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

var PORT = 3000;
var rooms = new Map();
var globalNames = new Set();
var activeSocketsByName = new Map();

function resolveUniqueName(requestedName, socketId) {
  var raw = (requestedName || '').trim();
  if (!raw) {
    raw = 'Player_' + Math.floor(1000 + Math.random() * 9000);
  }
  var baseName = raw;
  var lower = baseName.toLowerCase();

  var existingSocketId = activeSocketsByName.get(lower);
  if (existingSocketId && existingSocketId !== socketId) {
    var otherSocket = io.sockets.sockets.get ? io.sockets.sockets.get(existingSocketId) : (io.sockets.connected ? io.sockets.connected[existingSocketId] : null);
    if (otherSocket && otherSocket.connected) {
      var count = 1;
      var candidate = baseName + '_' + count;
      while (activeSocketsByName.has(candidate.toLowerCase())) {
        var candId = activeSocketsByName.get(candidate.toLowerCase());
        var candSocket = io.sockets.sockets.get ? io.sockets.sockets.get(candId) : (io.sockets.connected ? io.sockets.connected[candId] : null);
        if (!candSocket || !candSocket.connected) {
          break;
        }
        count++;
        candidate = baseName + '_' + count;
      }
      raw = candidate;
    }
  }

  return raw;
}

app.use(express.json());

// API Routes
app.get('/api/health', function (req, res) {
  res.json({ status: 'ok', activeRooms: rooms.size, timestamp: Date.now() });
});

function getRoomList() {
  return Array.from(rooms.values()).map(function (r) {
    return {
      id: r.config.id,
      name: r.config.name,
      mode: r.config.mode,
      boMode: r.config.boMode || 'BO1',
      playerCount: r.players.size,
      maxPlayers: r.config.maxPlayers,
      status: r.status,
      hostId: r.hostId,
      hasPassword: !!(r.config.password && r.config.password.length > 0),
    };
  });
}

function broadcastRoomList() {
  var roomList = getRoomList();
  io.emit('roomListUpdated', roomList);
}

function checkAndCleanupRoom(roomId) {
  var room = rooms.get(roomId);
  if (!room) return;

  var humanCount = 0;
  var playersArr = Array.from(room.players.values());
  for (var i = 0; i < playersArr.length; i++) {
    if (!playersArr[i].isBot) humanCount++;
  }

  if (humanCount === 0) {
    if (typeof room.destroy === 'function') {
      room.destroy();
    } else if (typeof room.stopLoop === 'function') {
      room.stopLoop();
    }
    rooms.delete(roomId);
    broadcastRoomList();
  } else {
    if (typeof room.updateHost === 'function') {
      room.updateHost();
    }
    broadcastRoomList();
  }
}

app.get('/api/rooms', function (req, res) {
  res.json(getRoomList());
});

// Helper to get local LAN IP addresses for network play
function getLocalNetworkIPs() {
  var interfaces = os.networkInterfaces();
  var addresses = [];
  for (var k in interfaces) {
    var ifaceList = interfaces[k] || [];
    for (var i = 0; i < ifaceList.length; i++) {
      var k2 = ifaceList[i];
      if (k2.family === 'IPv4' && !k2.internal) {
        addresses.push(k2.address);
      }
    }
  }
  return addresses;
}

// Socket.IO Connection Logic
io.on('connection', function (socket) {
  var currentRoomId = null;

  var handleLoginEvent = function (data, callback) {
    var requestedName = '';
    var requestedSticker = '🐥';

    if (typeof data === 'string') {
      requestedName = data;
    } else if (data && typeof data === 'object') {
      requestedName = data.username || data.name || '';
      requestedSticker = data.sticker || '🐥';
    }

    if (socket.playerName) {
      activeSocketsByName.delete(socket.playerName.toLowerCase());
      globalNames.delete(socket.playerName);
    }

    var finalName = resolveUniqueName(requestedName, socket.id);

    activeSocketsByName.set(finalName.toLowerCase(), socket.id);
    globalNames.add(finalName);

    socket.playerName = finalName;
    socket.playerSticker = requestedSticker;

    var response = {
      success: true,
      name: finalName,
      username: finalName,
      sticker: requestedSticker,
    };

    socket.emit('loginSuccess', response);
    socket.emit('login', response);

    if (typeof callback === 'function') {
      callback(response);
    }
  };

  socket.on('registerName', handleLoginEvent);
  socket.on('login', handleLoginEvent);

  socket.on('ping', function (callback) {
    if (typeof callback === 'function') callback();
  });

  socket.on('getRooms', function (callback) {
    var roomList = getRoomList();
    if (typeof callback === 'function') callback(roomList);
  });

  socket.on('sendChat', function (data) {
    if (!data) return;
    var msg = typeof data === 'string' ? data.trim().substring(0, 80) : ((data.message || '').trim().substring(0, 80));
    var emote = (data && (data.emote || data.emoji)) ? String(data.emote || data.emoji).trim() : '';

    if (!msg && !emote) return;

    var chatPayload = {
      senderId: socket.id,
      playerId: socket.id,
      senderName: socket.playerName || 'Vô danh',
      senderSticker: socket.playerSticker || '🐥',
      message: msg,
      emote: emote,
      emoji: emote || msg,
      timestamp: Date.now(),
    };

    var room = currentRoomId ? rooms.get(currentRoomId) : null;
    if (!room) {
      var allRooms = Array.from(rooms.values());
      for (var i = 0; i < allRooms.length; i++) {
        if (allRooms[i].players.has(socket.id)) {
          room = allRooms[i];
          break;
        }
      }
    }

    if (room) {
      room.handleChat(socket.id, msg, emote);
    } else {
      io.emit('lobbyChat', chatPayload);
      io.emit('chatMessage', chatPayload);
    }
  });

  var handleEmojiEvent = function (data) {
    if (!data) return;
    var emoji = typeof data === 'string' ? data.trim() : String(data.emoji || data.emote || '').trim();
    if (!emoji) return;

    var room = currentRoomId ? rooms.get(currentRoomId) : null;
    if (!room) {
      var allRooms = Array.from(rooms.values());
      for (var i = 0; i < allRooms.length; i++) {
        if (allRooms[i].players.has(socket.id)) {
          room = allRooms[i];
          break;
        }
      }
    }

    if (room) {
      if (typeof room.handleEmoji === 'function') {
        room.handleEmoji(socket.id, emoji);
      } else if (typeof room.handleChat === 'function') {
        room.handleChat(socket.id, '', emoji);
      }
    } else {
      var chatPayload = {
        senderId: socket.id,
        playerId: socket.id,
        senderName: socket.playerName || 'Vô danh',
        senderSticker: socket.playerSticker || '🐥',
        message: emoji,
        emote: emoji,
        emoji: emoji,
        timestamp: Date.now(),
      };
      io.emit('lobbyChat', chatPayload);
    }
  };

  socket.on('sendEmoji', handleEmojiEvent);
  socket.on('playerEmoji', handleEmojiEvent);
  socket.on('sendEmote', handleEmojiEvent);
  socket.on('playerEmote', handleEmojiEvent);

  socket.on('createRoom', function (config, callback) {
    if (!config) config = {};
    var requestedName = (config.roomName || config.name || '').trim();
    if (!requestedName) {
      var errorMsg = 'Tên phòng không hợp lệ hoặc đã tồn tại!';
      socket.emit('roomError', errorMsg);
      if (typeof callback === 'function') callback({ success: false, error: errorMsg });
      return;
    }

    // Check duplicate room name
    var existingRooms = Array.from(rooms.values());
    for (var i = 0; i < existingRooms.length; i++) {
      if (existingRooms[i].config.name.toLowerCase() === requestedName.toLowerCase()) {
        var errMsg = 'Tên phòng không hợp lệ hoặc đã tồn tại!';
        socket.emit('roomError', errMsg);
        if (typeof callback === 'function') {
          callback({ success: false, error: errMsg });
        }
        return;
      }
    }

    var roomId = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    var rawDuration = 180;
    if (config) {
      if (typeof config.matchDuration === 'number' && config.matchDuration > 0) {
        rawDuration = config.matchDuration;
      } else if (typeof config.duration === 'number' && config.duration > 0) {
        rawDuration = config.duration;
      } else if (config.matchDuration) {
        rawDuration = parseInt(config.matchDuration, 10) || 180;
      }
    }
    var durationSeconds = rawDuration <= 30 ? rawDuration * 60 : rawDuration;

    var fullConfig = {
      id: roomId,
      name: requestedName,
      password: (config.password || '').trim(),
      mode: config.mode || 'deathmatch',
      maxPlayers: parseInt(config.maxPlayers) || 4,
      matchDuration: durationSeconds,
      botCount: config.mode === 'teambattle' ? 0 : (config.botCount !== undefined && config.botCount !== null ? parseInt(config.botCount) : 0),
      botDifficulty: config.botDifficulty || 'medium',
      boMode: config.boMode || 'BO1',
    };

    var newRoom = new GameRoom(fullConfig, io);
    console.log('Phòng mới tạo với BO mode:', newRoom.boMode, '| Target wins required:', newRoom.winsNeeded);
    rooms.set(roomId, newRoom);
    broadcastRoomList();

    if (typeof callback === 'function') {
      callback({ success: true, roomId: roomId, maze: newRoom.maze, config: newRoom.config });
    }
  });

  socket.on('joinRoom', function (data, callback) {
    var roomId = data ? data.roomId : null;
    var playerName = data ? data.playerName : null;
    var password = data ? data.password : null;

    var room = rooms.get(roomId);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Phòng không tồn tại!' });
      return;
    }

    if (room.status !== 'waiting') {
      if (typeof callback === 'function') callback({ success: false, error: 'Phòng này đang trong trận đấu! Vui lòng chờ ván sau hoặc chọn phòng khác.' });
      return;
    }

    if (room.config.password && room.config.password.length > 0) {
      if (!password || password !== room.config.password) {
        if (typeof callback === 'function') callback({ success: false, error: 'Mật khẩu phòng không đúng!' });
        return;
      }
    }

    if (room.players.size >= room.config.maxPlayers) {
      var botPlayers = Array.from(room.players.values()).filter(function (p) { return p.isBot; });
      if (botPlayers.length > 0) {
        room.players.delete(botPlayers[botPlayers.length - 1].id);
      } else {
        if (typeof callback === 'function') callback({ success: false, error: 'Phòng đã đầy!' });
        return;
      }
    }

    socket.join(roomId);
    currentRoomId = roomId;
    var rawName = playerName || socket.playerName;
    var finalPlayerName = resolveUniqueName(rawName, socket.id);
    socket.playerName = finalPlayerName;
    activeSocketsByName.set(finalPlayerName.toLowerCase(), socket.id);
    globalNames.add(finalPlayerName);

    var sticker = (data && data.sticker) ? data.sticker : (socket.playerSticker || '🐥');
    var player = room.addPlayer(socket, finalPlayerName, sticker);
    broadcastRoomList();

    if (typeof callback === 'function') {
      callback({
        success: true,
        player: player,
        maze: room.maze,
        config: room.config,
        chatHistory: room.chatHistory || [],
      });
    }

    socket.to(roomId).emit('playerJoined', player);
  });

  socket.on('startMatch', function (callback) {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (!room) return;

    if (room.hostId !== socket.id) {
      var errMsg = 'Chỉ chủ phòng mới có quyền bắt đầu trận đấu!';
      socket.emit('roomError', errMsg);
      if (typeof callback === 'function') callback({ success: false, error: errMsg });
      return;
    }

    var res = room.startMatch();
    if (typeof callback === 'function') callback(res || { success: true });
  });

  socket.on('playerInput', function (inputData) {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (room) {
      room.handlePlayerInput(socket.id, inputData);
    }
  });

  socket.on('resetMatch', function () {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (room) {
      room.resetMatch();
    }
  });

  socket.on('switchTeam', function (data, callback) {
    if (!currentRoomId) return;
    var room = rooms.get(currentRoomId);
    if (!room) return;
    var team = data ? data.team : null;
    var ok = room.switchTeam(socket.id, team);
    if (typeof callback === 'function') callback({ success: ok });
  });

  var handleAddBot = function (data) {
    console.log('>>> RECEIVE addBotToTeam:', data);
    var rawTeam = (data && data.team) ? data.team : data;
    var team = rawTeam;
    var difficulty = (data && typeof data === 'object') ? (data.difficulty || data.botDifficulty) : undefined;

    var room = null;
    if (socket.roomId && rooms[socket.roomId]) {
      room = rooms[socket.roomId];
    } else if (currentRoomId && typeof rooms.get === 'function' && rooms.get(currentRoomId)) {
      room = rooms.get(currentRoomId);
    } else {
      var roomList = typeof rooms.values === 'function' ? Array.from(rooms.values()) : Object.values(rooms);
      room = roomList.find(function (r) {
        if (!r || !r.players) return false;
        if (typeof r.players.has === 'function') return r.players.has(socket.id);
        if (Array.isArray(r.players)) return r.players.some(function (p) { return p.id === socket.id; });
        return false;
      }) || roomList[0];
    }

    if (!room) {
      console.log('>>> ERROR: Room not found!');
      return;
    }

    if (typeof room.addBotToTeam === 'function') {
      room.addBotToTeam(team, difficulty);
      console.log('>>> ADDED BOT SUCCESS:', team || 'dm', 'Difficulty:', difficulty || 'default', 'Total:', room.players.size || room.players.length);
      return;
    }
  };

  var handleRemoveBot = function (data) {
    console.log('>>> RECEIVE removeBotFromTeam:', data);
    var rawTeam = (data && data.team) ? data.team : data;
    var team = rawTeam;

    var room = null;
    if (socket.roomId && rooms[socket.roomId]) {
      room = rooms[socket.roomId];
    } else if (currentRoomId && typeof rooms.get === 'function' && rooms.get(currentRoomId)) {
      room = rooms.get(currentRoomId);
    } else {
      var roomList = typeof rooms.values === 'function' ? Array.from(rooms.values()) : Object.values(rooms);
      room = roomList.find(function (r) {
        if (!r || !r.players) return false;
        if (typeof r.players.has === 'function') return r.players.has(socket.id);
        if (Array.isArray(r.players)) return r.players.some(function (p) { return p.id === socket.id; });
        return false;
      }) || roomList[0];
    }

    if (!room) return;

    if (typeof room.removeBotFromTeam === 'function') {
      room.removeBotFromTeam(team);
      console.log('>>> REMOVED BOT SUCCESS:', team || 'dm');
      return;
    }
  };

  socket.on('addBotToTeam', handleAddBot);
  socket.on('add_bot', handleAddBot);
  socket.on('removeBotFromTeam', handleRemoveBot);
  socket.on('remove_bot', handleRemoveBot);

  socket.on('disbandRoom', function (callback) {
    if (!currentRoomId) {
      if (typeof callback === 'function') callback({ success: false, error: 'Bạn không ở trong phòng nào!' });
      return;
    }

    var room = rooms.get(currentRoomId);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Phòng không tồn tại!' });
      return;
    }

    if (room.hostId !== socket.id) {
      if (typeof callback === 'function') callback({ success: false, error: 'Chỉ chủ phòng mới có quyền giải tán phòng!' });
      return;
    }

    var targetRoomId = currentRoomId;
    io.to(targetRoomId).emit('roomDisbanded', { message: 'Chủ phòng đã giải tán phòng!' });

    if (typeof room.destroy === 'function') {
      room.destroy();
    } else if (typeof room.stopLoop === 'function') {
      room.stopLoop();
    }

    rooms.delete(targetRoomId);
    broadcastRoomList();

    if (typeof callback === 'function') callback({ success: true });
  });

  socket.on('leaveRoom', function () {
    if (currentRoomId) {
      var room = rooms.get(currentRoomId);
      var roomToClean = currentRoomId;
      currentRoomId = null;

      if (room) {
        room.removePlayer(socket.id);
        socket.leave(roomToClean);
        socket.to(roomToClean).emit('playerLeft', { id: socket.id });
        checkAndCleanupRoom(roomToClean);
      }
    }
  });

  socket.on('disconnect', function () {
    if (socket.playerName) {
      activeSocketsByName.delete(socket.playerName.toLowerCase());
      globalNames.delete(socket.playerName);
      socket.playerName = null;
    }
    if (currentRoomId) {
      var room = rooms.get(currentRoomId);
      var roomToClean = currentRoomId;
      currentRoomId = null;

      if (room) {
        room.removePlayer(socket.id);
        socket.to(roomToClean).emit('playerLeft', { id: socket.id });
        checkAndCleanupRoom(roomToClean);
      }
    }
  });
});

async function startServer() {
  var distPath = path.join(process.cwd(), 'dist');
  var distExists = fs.existsSync(distPath);

  if (process.env.NODE_ENV !== 'production' && !distExists) {
    try {
      var viteModule = await import('vite');
      var vite = await viteModule.createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.log('Vite middleware skipped, serving static dist');
      app.use(express.static(distPath));
      app.get('*', function (req, res) {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  } else {
    app.use(express.static(distPath));
    app.get('*', function (req, res) {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', function () {
    var lanIPs = getLocalNetworkIPs();
    console.log('====================================================');
    console.log('🚀 Tank AZ Online Server (Node 14 Native) on port ' + PORT);
    console.log('🌐 Local Access: http://localhost:' + PORT);
    lanIPs.forEach(function (ip) {
      console.log('📡 LAN Access:   http://' + ip + ':' + PORT);
    });
    console.log('====================================================');
  });
}

startServer();
