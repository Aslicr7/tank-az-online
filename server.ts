/**
 * Tank AZ Online - Main Express & Socket.IO Server
 * Handles HTTP server, Socket connections, room management, LAN routing, and Vite integration.
 */

import express from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import { Server } from 'socket.io';
import { GameRoom, RoomConfig } from './server/room.ts';

const app = express();
const httpServer = http.createServer(app);

// Enable TCP_NODELAY on all incoming HTTP/WebSocket TCP sockets to eliminate Nagle buffering delay
httpServer.on('connection', (socket) => {
  socket.setNoDelay(true);
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  perMessageDeflate: false,
  httpCompression: false,
  transports: ['websocket', 'polling'],
  pingTimeout: 10000,
  pingInterval: 5000,
});

const PORT = 3000;
const rooms: Map<string, GameRoom> = new Map();
const activeSocketsByName: Map<string, string> = new Map();

function normalizePlayerName(rawName?: string): string {
  if (!rawName) return '';
  return rawName.trim().replace(/\s+/g, ' ');
}

function isNameTaken(requestedName: string, currentSocketId: string): boolean {
  const normalized = normalizePlayerName(requestedName);
  if (!normalized) return true;
  const lower = normalized.toLowerCase();

  // 1. Kiểm tra trong activeSocketsByName toàn server
  for (const [nameKey, socketId] of activeSocketsByName.entries()) {
    if (socketId !== currentSocketId) {
      if (normalizePlayerName(nameKey).toLowerCase() === lower) {
        const otherSocket = io.sockets.sockets.get(socketId);
        if (otherSocket && otherSocket.connected) {
          return true;
        }
      }
    }
  }

  // 2. Kiểm tra trong tất cả các phòng đang có người chơi
  for (const room of rooms.values()) {
    for (const [pId, player] of room.players.entries()) {
      if (pId !== currentSocketId && !player.isBot && player.name) {
        if (normalizePlayerName(player.name).toLowerCase() === lower) {
          return true;
        }
      }
    }
  }

  return false;
}

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', activeRooms: rooms.size, timestamp: Date.now() });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map((r) => ({
    id: r.config.id,
    name: r.config.name,
    mode: r.config.mode,
    playerCount: r.players.size,
    maxPlayers: r.config.maxPlayers,
    status: r.status,
  }));
  res.json(roomList);
});

// Helper to get local LAN IP addresses for network play
function getLocalNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const k in interfaces) {
    for (const k2 of interfaces[k] || []) {
      if (k2.family === 'IPv4' && !k2.internal) {
        addresses.push(k2.address);
      }
    }
  }
  return addresses;
}

// Create Default Public Room
const defaultRoomConfig: RoomConfig = {
  id: 'lobby_az_1',
  name: 'Mê Cung AZ Main',
  mode: 'deathmatch',
  maxPlayers: 6,
  botCount: 2,
  botDifficulty: 'medium',
  scoreToWin: 500,
};
rooms.set(defaultRoomConfig.id, new GameRoom(defaultRoomConfig, io));

// Socket.IO Connection Logic
io.on('connection', (socket) => {
  let currentRoomId: string | null = null;

  const handleLoginEvent = (data: any, callback?: Function) => {
    let requestedName = '';
    let requestedSticker = '🐥';

    if (typeof data === 'string') {
      requestedName = data;
    } else if (data && typeof data === 'object') {
      requestedName = data.username || data.name || '';
      requestedSticker = data.sticker || '🐥';
    }

    const sanitizedName = normalizePlayerName(requestedName);
    if (!sanitizedName) {
      const errorPayload = {
        success: false,
        error: 'Vui lòng nhập tên người chơi!',
      };
      socket.emit('loginError', errorPayload.error);
      if (typeof callback === 'function') callback(errorPayload);
      return;
    }

    // Kiểm tra trùng tên người chơi khác (sau khi đã chuẩn hóa khoảng trắng và đưa về lowercase)
    if (isNameTaken(sanitizedName, socket.id)) {
      const errorPayload = {
        success: false,
        error: 'Tên này đã có người sử dụng, vui lòng chọn tên khác!',
      };
      socket.emit('loginError', errorPayload.error);
      if (typeof callback === 'function') callback(errorPayload);
      return;
    }

    const prevName = (socket as any).playerName;
    if (prevName) {
      activeSocketsByName.delete(normalizePlayerName(prevName).toLowerCase());
    }

    const finalName = sanitizedName;
    activeSocketsByName.set(finalName.toLowerCase(), socket.id);
    (socket as any).playerName = finalName;
    (socket as any).playerSticker = requestedSticker;

    const responsePayload = {
      success: true,
      name: finalName,
      username: finalName,
      sticker: requestedSticker,
    };

    socket.emit('loginSuccess', responsePayload);
    socket.emit('login', responsePayload);

    if (typeof callback === 'function') {
      callback(responsePayload);
    }
  };

  socket.on('registerName', handleLoginEvent);
  socket.on('login', handleLoginEvent);

  // Latency ping test
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') callback();
  });

  const getRoomList = () => {
    const list: any[] = [];
    for (const r of rooms.values()) {
      const realHumans = Array.from(r.players.values()).filter((p) => !p.isBot);
      if (realHumans.length === 0) continue;
      list.push({
        id: r.config.id,
        name: r.config.name,
        mode: r.config.mode,
        boMode: r.config.boMode || 'BO1',
        playerCount: realHumans.length,
        maxPlayers: r.config.maxPlayers,
        status: r.status,
        hostId: r.hostId,
        hasPassword: !!(r.config.password && r.config.password.length > 0),
      });
    }
    return list;
  };

  const broadcastRoomList = () => {
    io.emit('roomListUpdated', getRoomList());
  };

  const cleanupRoomIfNoHumans = (room: GameRoom) => {
    if (!room) return;
    const humans = Array.from(room.players.values()).filter((p) => !p.isBot);
    if (humans.length === 0) {
      room.destroy();
      rooms.delete(room.config.id);
    } else {
      room.updateHost();
    }
    broadcastRoomList();
  };

  socket.on('getRooms', (callback) => {
    const roomList = getRoomList();
    if (typeof callback === 'function') callback(roomList);
  });

  socket.on('sendChat', (data) => {
    if (!data) return;
    const msg = typeof data === 'string' ? data.trim().substring(0, 80) : ((data.message || '').trim().substring(0, 80));
    const emote = (data && (data.emote || data.emoji)) ? String(data.emote || data.emoji).trim() : '';

    if (!msg && !emote) return;

    const chatPayload = {
      senderId: socket.id,
      playerId: socket.id,
      senderName: (socket as any).playerName || 'Vô danh',
      senderSticker: (socket as any).playerSticker || '🐥',
      message: msg,
      emote: emote,
      emoji: emote || msg,
      timestamp: Date.now(),
    };

    const room = getRoomBySocket(socket.id);
    if (room) {
      room.handleChat(socket.id, msg, emote);
    } else {
      io.emit('lobbyChat', chatPayload);
    }
  });

  const handleEmojiEvent = (data: any) => {
    if (!data) return;
    const emoji = typeof data === 'string' ? data.trim() : String(data.emoji || data.emote || '').trim();
    if (!emoji) return;

    const room = getRoomBySocket(socket.id);
    if (room) {
      if (typeof room.handleEmoji === 'function') {
        room.handleEmoji(socket.id, emoji);
      } else if (typeof room.handleChat === 'function') {
        room.handleChat(socket.id, '', emoji);
      }
    } else {
      const chatPayload = {
        senderId: socket.id,
        playerId: socket.id,
        senderName: (socket as any).playerName || 'Vô danh',
        senderSticker: (socket as any).playerSticker || '🐥',
        message: emoji,
        emote: emoji,
        emoji: emoji,
        timestamp: Date.now(),
      };
      io.emit('lobbyChat', chatPayload);
    }
  };

  socket.on('sendEmoji', handleEmojiEvent);
  socket.on('sendEmote', handleEmojiEvent);

  socket.on('createRoom', (config: any, callback) => {
    const roomId = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const roomName = (config && (config.roomName || config.name)) ? String(config.roomName || config.name).trim() : 'Phòng Xe Tăng ' + roomId.substring(5, 9);
    
    // Parse duration in seconds (convert minutes <= 30 to seconds)
    let rawDuration = 180;
    if (config) {
      if (typeof config.matchDuration === 'number' && config.matchDuration > 0) {
        rawDuration = config.matchDuration;
      } else if (typeof config.duration === 'number' && config.duration > 0) {
        rawDuration = config.duration;
      } else if (typeof config.roundTime === 'number' && config.roundTime > 0) {
        rawDuration = config.roundTime;
      } else if (typeof config.timeLimit === 'number' && config.timeLimit > 0) {
        rawDuration = config.timeLimit;
      }
    }

    let durationSeconds = 180;
    if (rawDuration <= 30) {
      durationSeconds = rawDuration * 60;
    } else {
      durationSeconds = rawDuration;
    }

    const fullConfig: RoomConfig = {
      id: roomId,
      name: roomName,
      password: (config && config.password) ? String(config.password).trim() : undefined,
      mode: (config && config.mode) ? config.mode : 'deathmatch',
      maxPlayers: (config && config.maxPlayers) ? parseInt(config.maxPlayers) : 4,
      matchDuration: durationSeconds,
      botCount: (config && typeof config.botCount === 'number') ? config.botCount : 1,
      botDifficulty: (config && config.botDifficulty) ? config.botDifficulty : 'medium',
      scoreToWin: (config && config.scoreToWin) ? config.scoreToWin : 500,
      boMode: (config && config.boMode) ? config.boMode : 'BO1',
    };

    const newRoom = new GameRoom(fullConfig, io);
    rooms.set(roomId, newRoom);
    broadcastRoomList();

    if (typeof callback === 'function') {
      callback({ success: true, roomId: roomId, maze: newRoom.maze, config: newRoom.config });
    }
  });

  socket.on('joinRoom', (data: any, callback) => {
    const roomId = data?.roomId || (typeof data === 'string' ? data : null);
    const playerName = data?.playerName;
    const password = data?.password;
    const requestedSticker = data?.sticker || data?.skin || (socket as any).playerSticker || '🐥';

    const room = rooms.get(roomId);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Phòng không tồn tại!' });
      return;
    }

    if (room.config.password && room.config.password.length > 0) {
      if (!password || password !== room.config.password) {
        if (typeof callback === 'function') callback({ success: false, error: 'Mật khẩu phòng không đúng!' });
        return;
      }
    }

    if (room.players.size >= room.config.maxPlayers) {
      const botPlayers = Array.from(room.players.values()).filter((p) => p.isBot);
      if (botPlayers.length > 0) {
        room.players.delete(botPlayers[botPlayers.length - 1].id);
      } else {
        if (typeof callback === 'function') callback({ success: false, error: 'Phòng đã đầy!' });
        return;
      }
    }

    const rawPlayerName = normalizePlayerName(playerName || (socket as any).playerName);
    if (!rawPlayerName) {
      if (typeof callback === 'function') callback({ success: false, error: 'Vui lòng nhập tên người chơi!' });
      return;
    }

    if (isNameTaken(rawPlayerName, socket.id)) {
      if (typeof callback === 'function') callback({ success: false, error: 'Tên này đã có người sử dụng, vui lòng chọn tên khác!' });
      return;
    }

    currentRoomId = roomId;
    const finalName = rawPlayerName;
    activeSocketsByName.set(finalName.toLowerCase(), socket.id);
    (socket as any).playerName = finalName;
    (socket as any).playerSticker = requestedSticker;

    const player = room.addPlayer(socket, finalName, requestedSticker);
    broadcastRoomList();

    if (typeof callback === 'function') {
      callback({
        success: true,
        player,
        maze: room.maze,
        config: room.config,
        chatHistory: room.chatHistory || [],
      });
    }

    socket.to(roomId).emit('playerJoined', player);
  });

  socket.on('disbandRoom', (callback) => {
    if (!currentRoomId) {
      if (typeof callback === 'function') callback({ success: false, error: 'Bạn không ở trong phòng nào!' });
      return;
    }

    const room = rooms.get(currentRoomId);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, error: 'Phòng không tồn tại!' });
      return;
    }

    if (room.hostId && room.hostId !== socket.id) {
      const errMsg = 'Chỉ chủ phòng mới có quyền giải tán phòng!';
      socket.emit('roomError', errMsg);
      if (typeof callback === 'function') callback({ success: false, error: errMsg });
      return;
    }

    const targetRoomId = currentRoomId;
    io.to(targetRoomId).emit('roomDisbanded', { message: 'Chủ phòng đã giải tán phòng!' });
    room.destroy();
    rooms.delete(targetRoomId);
    broadcastRoomList();

    if (typeof callback === 'function') callback({ success: true });
  });

  const getRoomBySocket = (socketId?: string) => {
    const id = socketId || socket.id;
    if (currentRoomId && rooms.has(currentRoomId)) {
      return rooms.get(currentRoomId);
    }
    for (const r of rooms.values()) {
      if (r.players.has(id)) {
        return r;
      }
    }
    return undefined;
  };

  socket.on('switchTeam', ({ team }) => {
    const room = getRoomBySocket();
    if (room) {
      room.switchTeam(socket.id, team);
    }
  });

  const handleAddBot = (data?: any) => {
    console.log('>>> RECEIVE addBotToTeam:', data);
    const rawTeam = typeof data === 'string' ? data : data?.team;
    const team = rawTeam;
    const difficulty = typeof data === 'object' ? (data?.difficulty || data?.botDifficulty) : undefined;

    let room = currentRoomId && rooms.has(currentRoomId) ? rooms.get(currentRoomId) : getRoomBySocket(socket.id);
    if (!room) {
      console.log('>>> ERROR: Room not found!');
      return;
    }

    if (typeof room.addBotToTeam === 'function') {
      room.addBotToTeam(team, difficulty);
      console.log('>>> ADDED BOT SUCCESS:', team || 'dm', 'Difficulty:', difficulty || 'default', 'Total:', room.players.size);
      return;
    }
  };
  socket.on('addBotToTeam', handleAddBot);
  socket.on('add_bot', handleAddBot);

  const handleRemoveBot = (data?: any) => {
    console.log('>>> RECEIVE removeBotFromTeam:', data);
    const rawTeam = typeof data === 'string' ? data : data?.team;
    const team = rawTeam;

    let room = currentRoomId && rooms.has(currentRoomId) ? rooms.get(currentRoomId) : getRoomBySocket(socket.id);
    if (!room) return;

    if (typeof room.removeBotFromTeam === 'function') {
      room.removeBotFromTeam(team);
      console.log('>>> REMOVED BOT SUCCESS:', team || 'dm');
      return;
    }
  };
  socket.on('removeBotFromTeam', handleRemoveBot);
  socket.on('remove_bot', handleRemoveBot);

  const handleStartMatch = (callback?: any) => {
    const room = getRoomBySocket();
    if (room) {
      if (room.hostId && room.hostId !== socket.id) {
        const errMsg = 'Chỉ chủ phòng mới có quyền bắt đầu trận đấu!';
        socket.emit('roomError', errMsg);
        if (typeof callback === 'function') callback({ success: false, error: errMsg });
        return;
      }
      const res = room.startMatch();
      if (typeof callback === 'function') callback(res || { success: true });
    }
  };
  socket.on('startMatch', handleStartMatch);
  socket.on('startGame', handleStartMatch);
  socket.on('startRound', handleStartMatch);

  socket.on('playerInput', (inputData) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.handlePlayerInput(socket.id, inputData);
    }
  });

  const handleResetMatch = () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.resetMatch();
    }
  };
  socket.on('resetMatch', handleResetMatch);
  socket.on('resetGame', handleResetMatch);

  socket.on('leaveRoom', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.removePlayer(socket.id);
        socket.leave(currentRoomId);
        socket.to(currentRoomId).emit('playerLeft', { id: socket.id });
        cleanupRoomIfNoHumans(room);
      }
      currentRoomId = null;
    }
  });

  socket.on('disconnect', () => {
    const pName = (socket as any).playerName;
    if (pName) {
      activeSocketsByName.delete(pName.toLowerCase());
      (socket as any).playerName = null;
    }
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.removePlayer(socket.id);
        socket.to(currentRoomId).emit('playerLeft', { id: socket.id });
        cleanupRoomIfNoHumans(room);
      }
    }
  });
});

async function startServer() {
  // Vite Dev Middleware or Static Production File Serving
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const lanIPs = getLocalNetworkIPs();
    console.log(`====================================================`);
    console.log(`🚀 Tank AZ Online Server is running on port ${PORT}`);
    console.log(`🌐 Local Access: http://localhost:${PORT}`);
    lanIPs.forEach((ip) => {
      console.log(`📡 LAN Access:   http://${ip}:${PORT}`);
    });
    console.log(`====================================================`);
  });
}

startServer();
