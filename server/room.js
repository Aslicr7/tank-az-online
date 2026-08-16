var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var room_exports = {};
__export(room_exports, {
  GameRoom: () => GameRoom,
  TANK_COLORS: () => TANK_COLORS,
  TEAM_BLUE_THEME: () => TEAM_BLUE_THEME,
  TEAM_RED_THEME: () => TEAM_RED_THEME
});
module.exports = __toCommonJS(room_exports);
var import_physics = require("./physics.js");
var import_bot = require("./bot.js");
const TANK_COLORS = [
  { name: "H\u1ED3ng ph\u1EA5n (Pink)", body: "#f472b6", border: "#db2777", barrel: "#be185d" },
  { name: "Xanh da tr\u1EDDi (Sky)", body: "#38bdf8", border: "#0284c7", barrel: "#0369a1" },
  { name: "V\xE0ng b\u01A1 (Butter)", body: "#facc15", border: "#ca8a04", barrel: "#a16207" },
  { name: "Xanh b\u1EA1c h\xE0 (Mint)", body: "#4ade80", border: "#16a34a", barrel: "#15803d" },
  { name: "T\xEDm o\u1EA3i h\u01B0\u01A1ng (Purple)", body: "#c084fc", border: "#9333ea", barrel: "#7e22ce" },
  { name: "Cam \u0111\xE0o (Peach)", body: "#fb923c", border: "#ea580c", barrel: "#c2410c" },
  { name: "Xanh ng\u1ECDc (Aqua)", body: "#2dd4bf", border: "#0d9488", barrel: "#115e59" },
  { name: "\u0110\u1ECF d\xE2u (Strawberry)", body: "#fb7185", border: "#e11d48", barrel: "#be123c" },
  { name: "V\xE0ng chanh (Lime)", body: "#a3e635", border: "#65a30d", barrel: "#4d7c0f" },
  { name: "Ch\xE0m pastel (Indigo)", body: "#818cf8", border: "#4f46e5", barrel: "#3730a3" }
];
const TEAM_RED_THEME = {
  name: "\u0110\u1ED9i \u0110\u1ECF (Strawberry / D\xE2u T\xE2y Pastel)",
  body: "#fb7185",
  border: "#e11d48",
  barrel: "#be123c",
  treads: "#881337",
  turretBorder: "#9f1239"
};
const TEAM_BLUE_THEME = {
  name: "\u0110\u1ED9i Xanh (Sky Blue / Da Tr\u1EDDi Pastel)",
  body: "#38bdf8",
  border: "#0284c7",
  barrel: "#0369a1",
  treads: "#075985",
  turretBorder: "#0c4a6e"
};
class GameRoom {
  constructor(config, io) {
    this.players = /* @__PURE__ */ new Map();
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.status = "waiting";
    this.chatHistory = [];
    this.boMode = "BO1";
    this.seriesScore = { red: 0, blue: 0 };
    this.winsNeeded = 1;
    this.currentRound = 1;
    this.startTime = 0;
    this.freezeUntil = 0;
    this.roundStartTime = Date.now();
    this.matchStartTime = Date.now();
    this.matchTimeRemaining = 180;
    this.timeAccumulator = 0;
    this.lastSecondBroadcast = -1;
    this.lastPowerupSpawn = 0;
    this.nextPowerupInterval = 15e3;
    this.bulletIdCounter = 0;
    this.tickCount = 0;
    var rawDur = config && typeof config.matchDuration === "number" && config.matchDuration > 0 ? config.matchDuration : 180;
    var durationSec = rawDur <= 30 ? rawDur * 60 : rawDur;
    config.matchDuration = durationSec;
    this.config = config;
    this.io = io;
    this.maze = import_physics.PhysicsEngine.generateMaze(9, 7, 100);
    this.matchStartTime = Date.now();
    this.roundStartTime = Date.now();
    this.matchTimeRemaining = durationSec;
    this.timeAccumulator = 0;
    this.nextPowerupInterval = 1e4;
    this.boMode = config && config.boMode ? config.boMode : "BO1";
    if (this.boMode === "BO3" || this.boMode === "3") {
      this.winsNeeded = 3;
    } else if (this.boMode === "BO5" || this.boMode === "5") {
      this.winsNeeded = 5;
    } else {
      this.winsNeeded = 1;
    }
    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;
    this.spawnInitialPowerups();
    this.startLoop();
  }
  updateHost() {
    const humans = Array.from(this.players.values()).filter((p) => !p.isBot);
    if (humans.length > 0) {
      if (!this.hostId || !humans.some((p) => p.id === this.hostId)) {
        this.hostId = humans[0].id;
      }
    } else {
      this.hostId = void 0;
    }
  }
  destroy() {
    this.stopLoop();
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = void 0;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = void 0;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    this.players.clear();
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
  }
  addPlayer(socket, name, sticker) {
    const maxP = this.config.maxPlayers || 10;
    while (this.players.size >= maxP) {
      const currentArr = Array.from(this.players.values());
      const botToTrim = currentArr.slice().reverse().find((p) => p.isBot);
      if (botToTrim) {
        this.players.delete(botToTrim.id);
      } else {
        break;
      }
    }
    let team = void 0;
    if (this.config.mode === "teambattle") {
      const redCount = Array.from(this.players.values()).filter((p) => p.team === "red").length;
      const blueCount = Array.from(this.players.values()).filter((p) => p.team === "blue").length;
      team = redCount <= blueCount ? "red" : "blue";
    }
    const spawnPoint = this.getRandomSpawnPoint();
    const playerSticker = sticker || socket.playerSticker || "\u{1F425}";
    const player = {
      id: socket.id,
      socketId: socket.id,
      name: name || `Tank_${socket.id.substring(0, 4)}`,
      sticker: playerSticker,
      difficulty: "easy",
      x: spawnPoint.x,
      y: spawnPoint.y,
      bodyAngle: Math.random() * Math.PI * 2,
      turretAngle: 0,
      radius: 18,
      moveSpeed: 150,
      turnRate: 2,
      isBot: false,
      color: this.getUniqueColor(team),
      hp: 1,
      maxHp: 1,
      alive: true,
      isDead: false,
      lives: 3,
      extraLives: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      team,
      lastShotTime: 0,
      shootCooldown: 1,
      isReady: true,
      specialAmmo: 0
    };
    this.players.set(socket.id, player);
    socket.join(this.config.id);
    this.updateHost();
    this.adjustBots();
    if (!this.intervalId) {
      this.startLoop();
    }
    this.broadcastState();
    return player;
  }
  startMatch() {
    if (this.config.mode === "teambattle") {
      const redCount = Array.from(this.players.values()).filter((p) => p.team === "red").length;
      const blueCount = Array.from(this.players.values()).filter((p) => p.team === "blue").length;
      if (redCount < 1 || blueCount < 1) {
        const errorMsg = "C\u1EA3 \u0110\u1ED9i \u0110\u1ECF v\xE0 \u0110\u1ED9i Xanh \u0111\u1EC1u ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 th\xE0nh vi\xEAn \u0111\u1EC3 b\u1EAFt \u0111\u1EA7u tr\u1EADn \u0111\u1EA5u!";
        this.io.to(this.config.id).emit("roomError", errorMsg);
        this.io.to(this.config.id).emit("errorMessage", errorMsg);
        return { success: false, error: errorMsg };
      }
    }
    this.resetMatch();
    return { success: true };
  }
  startGame() {
    this.resetMatch();
  }
  startRound() {
    this.resetMatch();
  }
  resetGame() {
    this.resetMatch();
  }
  removePlayer(socketId) {
    this.players.delete(socketId);
    this.updateHost();
    this.adjustBots();
    this.broadcastState();
    const humanCount = Array.from(this.players.values()).filter((p) => !p.isBot).length;
    if (humanCount === 0) {
      this.stopLoop();
    } else if (this.status === "playing" && this.config.mode === "teambattle") {
      this.checkTeamElimination();
    }
  }
  switchTeam(socketId, team) {
    const player = this.players.get(socketId);
    if (player && this.config.mode === "teambattle") {
      player.team = team;
      player.color = this.getUniqueColor(team);
      this.broadcastState();
    }
  }
  addBotToTeam(team, difficulty) {
    if (this.players.size >= (this.config.maxPlayers || 10)) return;
    let botTeam = void 0;
    if (team === "red" || team === "blue") {
      botTeam = team;
    } else if (team === "none" || team === "deathmatch") {
      botTeam = "none";
    }
    const allBots = Array.from(this.players.values()).filter((p) => p.isBot);
    const botNum = allBots.length + 1;
    const botStickers = ["\u{1F916}", "\u{1F425}", "\u{1F431}", "\u2B50", "\u{1F331}", "\u{1F338}", "\u{1F430}", "\u2764\uFE0F"];
    const botSticker = botStickers[(botNum - 1) % botStickers.length];
    let botName = `Bot AI ${botNum}`;
    let color = this.getUniqueColor(void 0);
    if (botTeam === "red") {
      const redBots = allBots.filter((p) => p.team === "red");
      botName = `Bot \u0110\u1ECF ${redBots.length + 1}`;
      color = TEAM_RED_THEME.body;
    } else if (botTeam === "blue") {
      const blueBots = allBots.filter((p) => p.team === "blue");
      botName = `Bot Xanh ${blueBots.length + 1}`;
      color = TEAM_BLUE_THEME.body;
    }
    const botId = `bot_${botTeam || "dm"}_${Date.now()}_${Math.floor(Math.random() * 1e3)}`;
    const spawnPoint = this.getRandomSpawnPoint();
    const botPlayer = {
      id: botId,
      name: botName,
      sticker: botSticker,
      difficulty: difficulty || "smart",
      x: spawnPoint.x,
      y: spawnPoint.y,
      bodyAngle: Math.random() * Math.PI * 2,
      turretAngle: 0,
      radius: 18,
      moveSpeed: 150,
      turnRate: 2,
      isBot: true,
      color,
      hp: 1,
      maxHp: 1,
      alive: true,
      isDead: false,
      lives: 3,
      extraLives: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      team: botTeam,
      lastShotTime: 0,
      shootCooldown: 1,
      isReady: true,
      specialAmmo: 0
    };
    this.players.set(botId, botPlayer);
    this.broadcastState();
  }
  removeBotFromTeam(team) {
    let botsToRemove = Array.from(this.players.values()).filter((p) => p.isBot);
    if (team === "red" || team === "blue") {
      botsToRemove = botsToRemove.filter((p) => p.team === team);
    } else if (team === "none" || team === "deathmatch") {
      botsToRemove = botsToRemove.filter((p) => !p.team || p.team === "none");
    }
    if (botsToRemove.length === 0) return;
    const botToRemove = botsToRemove[botsToRemove.length - 1];
    this.players.delete(botToRemove.id);
    this.broadcastState();
  }
  adjustBots() {
    const maxP = this.config.maxPlayers || 10;
    while (this.players.size > maxP) {
      const currentArr = Array.from(this.players.values());
      const botToTrim = currentArr.slice().reverse().find((p) => p.isBot);
      if (botToTrim) {
        this.players.delete(botToTrim.id);
      } else {
        break;
      }
    }
  }
  getPlayerBySocketId(socketId) {
    const player = this.players.get(socketId);
    if (player) return player;
    return Array.from(this.players.values()).find((p) => p.socketId === socketId || p.id === socketId);
  }
  handleChat(socketId, msg, emote) {
    const senderPlayer = this.getPlayerBySocketId(socketId);
    const senderId = senderPlayer ? senderPlayer.id : socketId;
    const senderName = senderPlayer ? senderPlayer.name : "V\xF4 danh";
    const senderSticker = senderPlayer ? senderPlayer.sticker || "\u{1F425}" : "\u{1F425}";
    const senderColor = senderPlayer ? senderPlayer.color : "#38bdf8";
    const chatPayload = {
      senderId,
      playerId: senderId,
      senderName,
      senderSticker,
      senderColor,
      message: msg || "",
      emote: emote || "",
      emoji: emote || msg || "",
      timestamp: Date.now()
    };
    if (!this.chatHistory) {
      this.chatHistory = [];
    }
    if (msg && msg.trim()) {
      this.chatHistory.push(chatPayload);
      if (this.chatHistory.length > 50) {
        this.chatHistory.shift();
      }
    }
    this.io.to(this.config.id).emit("chatMessage", chatPayload);
    if (emote) {
      const expiresAt = Date.now() + 2500;
      if (senderPlayer) {
        senderPlayer.currentEmoji = emote;
        senderPlayer.emojiExpiresAt = expiresAt;
      }
      this.io.to(this.config.id).emit("playerEmoji", {
        playerId: senderId,
        emoji: emote,
        expiresAt
      });
    }
  }
  handleEmoji(socketId, emoji) {
    const senderPlayer = this.getPlayerBySocketId(socketId);
    const senderId = senderPlayer ? senderPlayer.id : socketId;
    const expiresAt = Date.now() + 2500;
    if (senderPlayer) {
      senderPlayer.currentEmoji = emoji;
      senderPlayer.emojiExpiresAt = expiresAt;
    }
    this.io.to(this.config.id).emit("playerEmoji", {
      playerId: senderId,
      emoji,
      expiresAt
    });
  }
  handlePlayerInput(socketId, input) {
    const player = this.players.get(socketId);
    if (!player || player.hp <= 0 || this.status !== "playing") return;
    player.currentInput = {
      forward: !!input.forward,
      backward: !!input.backward,
      turnLeft: !!input.turnLeft,
      turnRight: !!input.turnRight,
      turretAngle: typeof input.turretAngle === "number" ? input.turretAngle : player.turretAngle || 0,
      shoot: !!input.shoot,
      joystickActive: !!input.joystickActive,
      targetAngle: typeof input.targetAngle === "number" ? input.targetAngle : 0,
      intensity: typeof input.intensity === "number" ? Math.max(0, Math.min(1, input.intensity)) : 0
    };
    player.lastInputTime = Date.now();
  }
  processPlayerMovement(player, input, dt) {
    if (this.status !== "playing" || player.hp <= 0) return;
    const now = Date.now();
    const isSpeed = player.speedTimer && now < player.speedTimer || player.activePowerup === "speed";
    const speed = isSpeed ? player.moveSpeed * 1.4 : player.moveSpeed;
    if (input && input.joystickActive && typeof input.intensity === "number" && input.intensity > 0) {
      const targetAngle = typeof input.targetAngle === "number" ? input.targetAngle : 0;
      const intensity = Math.min(1, Math.max(0, input.intensity));
      player.bodyAngle = targetAngle;
      player.turretAngle = targetAngle;
      const moveX = Math.cos(targetAngle) * speed * intensity * dt;
      const moveY = Math.sin(targetAngle) * speed * intensity * dt;
      const newPos = { x: player.x + moveX, y: player.y + moveY, radius: player.radius };
      for (const wall of this.maze.walls) {
        const res = import_physics.PhysicsEngine.resolveCircleWallCollision(newPos, wall);
        if (res.collided) {
          newPos.x = res.x;
          newPos.y = res.y;
        }
      }
      player.x = Math.max(player.radius, Math.min(this.maze.width - player.radius, newPos.x));
      player.y = Math.max(player.radius, Math.min(this.maze.height - player.radius, newPos.y));
    } else {
      const turnRate = player.turnRate || 2;
      if (input.turnLeft) {
        player.bodyAngle -= turnRate * dt;
      }
      if (input.turnRight) {
        player.bodyAngle += turnRate * dt;
      }
      let moveX = 0;
      let moveY = 0;
      if (input.forward) {
        moveX += Math.cos(player.bodyAngle) * speed * dt;
        moveY += Math.sin(player.bodyAngle) * speed * dt;
      }
      if (input.backward) {
        moveX -= Math.cos(player.bodyAngle) * speed * 0.6 * dt;
        moveY -= Math.sin(player.bodyAngle) * speed * 0.6 * dt;
      }
      const newPos = { x: player.x + moveX, y: player.y + moveY, radius: player.radius };
      for (const wall of this.maze.walls) {
        const res = import_physics.PhysicsEngine.resolveCircleWallCollision(newPos, wall);
        if (res.collided) {
          newPos.x = res.x;
          newPos.y = res.y;
        }
      }
      player.x = Math.max(player.radius, Math.min(this.maze.width - player.radius, newPos.x));
      player.y = Math.max(player.radius, Math.min(this.maze.height - player.radius, newPos.y));
      player.turretAngle = player.bodyAngle;
    }
    if (input.shoot) {
      this.fireBullet(player);
      input.shoot = false;
    }
  }
  fireBullet(player) {
    if (this.status !== "playing" || player.hp <= 0) return;
    const now = Date.now();
    const hasSpecialAmmo = Boolean(player.activeBulletType && (player.specialAmmo === void 0 || player.specialAmmo > 0));
    const bulletType = hasSpecialAmmo ? player.activeBulletType : void 0;
    const isRapid = player.rapidFireTimer && now < player.rapidFireTimer || player.activePowerup === "rapidFire";
    const isLaser = bulletType === "laser" || player.activeBulletType === "laser" || player.activePowerup === "laser";
    let cd = 1;
    if (isLaser) {
      cd = 0.9;
    } else if (isRapid) {
      cd = 0.4;
    }
    const lastFired = player.lastFireTime || player.lastShotTime || 0;
    if (now - lastFired < cd * 1e3) return;
    if (bulletType) {
      player.specialAmmo = (player.specialAmmo !== void 0 ? player.specialAmmo : 5) - 1;
      if (player.specialAmmo <= 0) {
        player.activeBulletType = void 0;
        player.specialAmmo = 0;
        if (player.activePowerup === bulletType) {
          player.activePowerup = void 0;
        }
      }
    }
    player.lastShotTime = now;
    player.lastFireTime = now;
    if (bulletType === "laser") {
      const barrelLen2 = player.radius + 14;
      const bx = player.x + Math.cos(player.turretAngle) * barrelLen2;
      const by = player.y + Math.sin(player.turretAngle) * barrelLen2;
      const hitResult = import_physics.PhysicsEngine.raycastLaser(
        bx,
        by,
        player.turretAngle,
        this.maze.walls,
        this.maze.width,
        this.maze.height,
        2e3
      );
      const laserAimDuration = 120;
      const laserBlastDuration = 160;
      const beamId = `laser_${this.bulletIdCounter++}_${now}`;
      const laserBeam = {
        id: beamId,
        shooterId: player.id,
        shooterColor: player.color,
        x1: bx,
        y1: by,
        x2: hitResult.x,
        y2: hitResult.y,
        color: "#ef4444",
        createdAt: now,
        chargeUntil: now + laserAimDuration,
        blastExpiresAt: now + laserAimDuration + laserBlastDuration,
        expiresAt: now + laserAimDuration + laserBlastDuration,
        hasDealtDamage: false
      };
      this.laserBeams.push(laserBeam);
      const laserPayload = {
        id: laserBeam.id,
        shooterId: player.id,
        shooterColor: player.color,
        x1: bx,
        y1: by,
        x2: hitResult.x,
        y2: hitResult.y,
        color: "#ef4444",
        createdAt: now,
        aimDuration: 120,
        blastDuration: 160
      };
      this.io.to(this.config.id).emit("laserAiming", laserPayload);
      setTimeout(() => {
        try {
          this.triggerLaserBlastDamage(player, player.turretAngle, bx, by, hitResult.x, hitResult.y, laserBeam.id);
        } catch (err) {
          console.error("[Room] Error in triggerLaserBlastDamage callback:", err);
        }
      }, 120);
      return;
    }
    const isFast = bulletType === "fastBullet";
    const isBig = bulletType === "bigBullet" || bulletType === "piercing";
    const isBounce = bulletType === "crazyBounce" || bulletType === "bounce" || bulletType === "ricochet";
    const barrelLen = isBig ? player.radius + 18 : player.radius + 12;
    const bulletX = player.x + Math.cos(player.turretAngle) * barrelLen;
    const bulletY = player.y + Math.sin(player.turretAngle) * barrelLen;
    const bulletSpeed = isFast ? 520 : 380;
    const vx = Math.cos(player.turretAngle) * bulletSpeed;
    const vy = Math.sin(player.turretAngle) * bulletSpeed;
    const bullet = {
      id: `b_${this.bulletIdCounter++}_${now}`,
      ownerId: player.id,
      ownerName: player.name,
      ownerTeam: player.team,
      x: bulletX,
      y: bulletY,
      vx,
      vy,
      radius: isBig ? 15 : 5,
      bounces: 0,
      maxBounces: isBounce ? 10 : 3,
      color: isFast ? "#ef4444" : isBig ? "#a855f7" : isBounce ? "#10b981" : "#facc15",
      createdAt: now,
      ignoreOwnerUntil: isBig ? now + 120 : now + 60
      // Bỏ qua va chạm người bắn 120ms đầu
    };
    this.bullets.push(bullet);
    this.io.to(this.config.id).emit("bulletFired", {
      x: bulletX,
      y: bulletY,
      angle: player.turretAngle,
      ownerId: player.id,
      color: bullet.color,
      radius: bullet.radius
    });
  }
  startLoop() {
    const tickRate = 30;
    const dt = 1 / tickRate;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = void 0;
    }
    this.intervalId = setInterval(() => {
      if (this.status === "playing") {
        this.update(dt);
      } else if (this.players.size > 0) {
        this.broadcastState();
      } else {
        this.stopLoop();
      }
    }, 1e3 / tickRate);
  }
  stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = void 0;
    }
  }
  triggerLaserBlastDamage(player, angle, startX, startY, targetX, targetY, beamId) {
    if (!player || this.status !== "playing" && this.status !== "round_paused") return;
    let endX = targetX;
    let endY = targetY;
    if (endX === void 0 || endY === void 0) {
      const hitResult = import_physics.PhysicsEngine.raycastLaser(
        startX,
        startY,
        angle,
        this.maze.walls,
        this.maze.width,
        this.maze.height,
        2e3
      );
      endX = hitResult.x;
      endY = hitResult.y;
    }
    const now = Date.now();
    const beam = this.laserBeams.find((b) => b.id === beamId);
    if (beam) {
      beam.hasDealtDamage = true;
    }
    this.io.to(this.config.id).emit("laserBlasted", {
      id: beamId || `blast_${now}`,
      shooterId: player.id,
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY
    });
    const shooter = this.players.get(player.id) || player;
    for (const tank of this.players.values()) {
      if (tank.id === player.id || tank.hp <= 0) continue;
      if (this.config.mode === "teambattle" && shooter?.team && tank.team && shooter.team === tank.team) {
        continue;
      }
      const targetIsImmune = tank.shieldTimer && now < tank.shieldTimer || tank.activePowerup === "shield" || tank.spawnInvincibleTimer && now < tank.spawnInvincibleTimer;
      if (targetIsImmune) continue;
      const dist = import_physics.PhysicsEngine.distToSegment({ x: tank.x, y: tank.y }, { x: startX, y: startY }, { x: endX, y: endY });
      if (dist <= tank.radius + 14) {
        if (tank.extraLives && tank.extraLives > 0) {
          tank.extraLives -= 1;
          tank.extraLife = tank.extraLives > 0;
          this.io.to(this.config.id).emit("bulletBounced", {
            x: tank.x,
            y: tank.y,
            normal: { x: 0, y: -1 }
          });
        } else {
          this.destroyTank(tank, shooter);
        }
      }
    }
  }
  destroyTank(player, shooter) {
    player.hp = 0;
    player.alive = false;
    player.isDead = true;
    player.activeBulletType = void 0;
    player.specialAmmo = 0;
    player.shieldTimer = void 0;
    player.speedTimer = void 0;
    player.rapidFireTimer = void 0;
    player.activePowerup = void 0;
    player.powerupTimer = void 0;
    player.extraLife = false;
    player.extraLives = 0;
    player.deaths += 1;
    player.score = Math.max(0, player.kills * 100 - player.deaths * 50);
    if (shooter) {
      if (shooter.id !== player.id) {
        shooter.kills += 1;
        shooter.score = Math.max(0, shooter.kills * 100 - shooter.deaths * 50);
      } else {
        shooter.score = Math.max(0, shooter.kills * 100 - shooter.deaths * 50);
      }
    }
    this.io.to(this.config.id).emit("tankExploded", {
      x: player.x,
      y: player.y,
      playerName: player.name,
      color: player.color
    });
    if (this.config.mode === "teambattle") {
      this.checkTeamElimination();
    } else {
      setTimeout(() => {
        if (this.players.has(player.id) && this.status === "playing") {
          const respawnPos = this.getRandomSpawnPoint();
          player.x = respawnPos.x;
          player.y = respawnPos.y;
          player.hp = 1;
          player.alive = true;
          player.isDead = false;
          player.bodyAngle = Math.random() * Math.PI * 2;
        }
      }, 2500);
    }
  }
  checkTeamElimination() {
    if (this.status !== "playing" || this.config.mode !== "teambattle") return;
    const playersArr = Array.from(this.players.values());
    const redPlayers = playersArr.filter((p) => p.team === "red");
    const bluePlayers = playersArr.filter((p) => p.team === "blue");
    if (redPlayers.length > 0 && bluePlayers.length > 0) {
      const redAlive = redPlayers.filter((p) => (p.hp || 0) > 0 && p.alive !== false && !p.isDead).length;
      const blueAlive = bluePlayers.filter((p) => (p.hp || 0) > 0 && p.alive !== false && !p.isDead).length;
      if (redAlive === 0 && blueAlive > 0) {
        this.handleTeamRoundEnd("blue");
      } else if (blueAlive === 0 && redAlive > 0) {
        this.handleTeamRoundEnd("red");
      } else if (redAlive === 0 && blueAlive === 0) {
        this.handleTeamRoundEnd("draw");
      }
    } else if (Date.now() - this.roundStartTime > 2e3) {
      if (redPlayers.length > 0 && bluePlayers.length === 0) {
        this.handleTeamRoundEnd("red", true);
      } else if (bluePlayers.length > 0 && redPlayers.length === 0) {
        this.handleTeamRoundEnd("blue", true);
      }
    }
  }
  handleTeamRoundEnd(winningTeam, isForfeit = false) {
    if (this.status !== "playing") return;
    this.status = "round_paused";
    this.bullets = [];
    this.laserBeams = [];
    if (winningTeam === "red") {
      this.seriesScore.red += 1;
    } else if (winningTeam === "blue") {
      this.seriesScore.blue += 1;
    }
    const isMatchOver = isForfeit || this.seriesScore.red >= this.winsNeeded || this.seriesScore.blue >= this.winsNeeded || this.winsNeeded === 1 && winningTeam !== "draw";
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    const delaySeconds = 3;
    const roundPayload = {
      roundWinnerTeam: winningTeam,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      currentRound: this.currentRound,
      delaySeconds,
      isMatchOver
    };
    this.io.to(this.config.id).emit("roundEnding", roundPayload);
    this.io.to(this.config.id).emit("roundEnded", roundPayload);
    this.broadcastState();
    if (isMatchOver) {
      this.roundObservationTimeout = setTimeout(() => {
        try {
          if (this.players.size > 0 && this.status === "round_paused") {
            let finalWinnerTeam = winningTeam;
            if (finalWinnerTeam === "draw") {
              if (this.seriesScore.red > this.seriesScore.blue) finalWinnerTeam = "red";
              else if (this.seriesScore.blue > this.seriesScore.red) finalWinnerTeam = "blue";
            }
            this.endMatch(isForfeit ? "opponent_forfeit" : "team_eliminated", void 0, finalWinnerTeam);
          }
        } catch (err) {
          console.error("[Room] Error during endMatch after 3s freeze:", err);
        }
      }, delaySeconds * 1e3);
    } else {
      this.roundEndingTimeout = setTimeout(() => {
        try {
          if (this.players.size > 0 && (this.status === "round_paused" || this.status === "playing")) {
            this.startNextRound();
          }
        } catch (err) {
          console.error("[Room] Error during startNextRound in roundEndingTimeout:", err);
        }
      }, delaySeconds * 1e3);
    }
  }
  startNextRound() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = void 0;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    this.currentRound += 1;
    this.winner = void 0;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.timeAccumulator = 0;
    this.lastSecondBroadcast = -1;
    this.lastPowerupSpawn = Date.now();
    this.nextPowerupInterval = 1e4;
    this.maze = import_physics.PhysicsEngine.generateMaze(9, 7, 100);
    const now = Date.now();
    const bannerDuration = 2e3;
    this.startTime = now + bannerDuration;
    this.freezeUntil = this.startTime;
    this.matchStartTime = this.startTime;
    for (const player of this.players.values()) {
      const spawn = this.getRandomSpawnPoint();
      player.x = spawn.x;
      player.y = spawn.y;
      player.bodyAngle = Math.random() * Math.PI * 2;
      player.turretAngle = player.bodyAngle;
      player.hp = 1;
      player.maxHp = 1;
      player.alive = true;
      player.isDead = false;
      player.extraLives = 0;
      player.extraLife = false;
      player.activeBulletType = void 0;
      player.specialAmmo = 0;
      player.shieldTimer = void 0;
      player.speedTimer = void 0;
      player.rapidFireTimer = void 0;
      player.activePowerup = void 0;
      player.powerupTimer = void 0;
      player.spawnInvincibleTimer = this.startTime + 2500;
      player.currentInput = void 0;
      player.lastInput = void 0;
    }
    this.spawnInitialPowerups();
    this.status = "preparing";
    this.io.to(this.config.id).emit("nextRoundStarted", {
      maze: this.maze,
      currentRound: this.currentRound,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      timeRemaining: this.matchTimeRemaining,
      startTime: this.startTime,
      freezeUntil: this.freezeUntil,
      bannerDuration,
      status: "preparing",
      matchState: "preparing",
      isStarting: true
    });
    this.broadcastState();
    this.preparationTimeout = setTimeout(() => {
      try {
        if (this.players.size > 0 && this.status === "preparing") {
          this.status = "playing";
          this.timeAccumulator = 0;
          this.roundStartTime = Date.now();
          this.io.to(this.config.id).emit("matchPlaying", {
            currentRound: this.currentRound,
            timeRemaining: this.matchTimeRemaining,
            status: "playing",
            matchState: "playing"
          });
          this.broadcastState();
        }
      } catch (err) {
        console.error("[Room] Error in preparationTimeout callback (next round):", err);
      }
    }, bannerDuration);
  }
  endMatch(reason, specificWinner, specificWinningTeam) {
    if (this.status === "finished" || this.status === "gameover") return;
    this.status = "finished";
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    const playersArr = Array.from(this.players.values());
    this.bullets = [];
    this.laserBeams = [];
    let mvp = null;
    let winner = specificWinner || this.winner;
    let winningTeam = specificWinningTeam;
    let winningMembers = [];
    if (this.config.mode === "teambattle") {
      const redPlayers = playersArr.filter((p) => p.team === "red");
      const bluePlayers = playersArr.filter((p) => p.team === "blue");
      const redKills = redPlayers.reduce((acc, p) => acc + (p.kills || 0), 0);
      const blueKills = bluePlayers.reduce((acc, p) => acc + (p.kills || 0), 0);
      const redAlive = redPlayers.filter((p) => p.hp > 0).length;
      const blueAlive = bluePlayers.filter((p) => p.hp > 0).length;
      if (!winningTeam) {
        if (this.seriesScore.red > this.seriesScore.blue) {
          winningTeam = "red";
        } else if (this.seriesScore.blue > this.seriesScore.red) {
          winningTeam = "blue";
        } else if (redAlive > 0 && blueAlive === 0) {
          winningTeam = "red";
        } else if (blueAlive > 0 && redAlive === 0) {
          winningTeam = "blue";
        } else if (redKills > blueKills) {
          winningTeam = "red";
        } else if (blueKills > redKills) {
          winningTeam = "blue";
        } else {
          winningTeam = "draw";
        }
      }
      const winningPlayerList = winningTeam === "red" ? redPlayers : winningTeam === "blue" ? bluePlayers : [];
      winningMembers = winningPlayerList.map((p) => {
        const killCount = p.kills || 0;
        const prefix = p.isBot ? "\u{1F916}" : "\u{1F451}";
        return `${prefix} ${p.name} (${killCount} Kills)`;
      });
    }
    const winnersList = winningTeam === "red" || winningTeam === "blue" ? playersArr.filter((p) => p.team === winningTeam).map((p) => ({
      name: p.name,
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      score: p.score || 0,
      isBot: !!p.isBot,
      sticker: p.sticker || (p.isBot ? "\u{1F916}" : "\u{1F425}")
    })) : [];
    if (playersArr.length > 0) {
      const sortedByScore = [...playersArr].sort((a, b) => {
        const scoreA = Math.max(0, a.score !== void 0 ? a.score : (a.kills || 0) * 100 - (a.deaths || 0) * 50);
        const scoreB = Math.max(0, b.score !== void 0 ? b.score : (b.kills || 0) * 100 - (b.deaths || 0) * 50);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.kills || 0) - (a.kills || 0);
      });
      const top = sortedByScore[0];
      const topScore = Math.max(0, top.score !== void 0 ? top.score : (top.kills || 0) * 100 - (top.deaths || 0) * 50);
      mvp = {
        id: top.id,
        name: top.name,
        sticker: top.sticker || (top.isBot ? "\u{1F916}" : "\u{1F425}"),
        score: topScore,
        kills: top.kills || 0,
        deaths: top.deaths || 0,
        team: top.team
      };
      if (!winner) {
        winner = { id: top.id, name: top.name, score: topScore };
      }
    } else {
      mvp = { name: "Ng\u01B0\u1EDDi ch\u01A1i", sticker: "\u{1F425}", score: 0, kills: 0, deaths: 0 };
    }
    this.winner = winner;
    const matchEndPayload = {
      type: "match_ended",
      roomName: this.config.name,
      mode: this.config.mode,
      winner: this.winner,
      mvp,
      winnerTeam: winningTeam,
      winningTeam,
      winningMembers,
      winners: winnersList,
      members: winnersList,
      finalScore: this.seriesScore,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      forfeitMessage: reason === "opponent_forfeit" ? "\u0110\u1ED0I TH\u1EE6 \u0110\xC3 THO\xC1T TR\u1EACN! \u0110\u1ED8I B\u1EA0N TH\u1EAENG CHUNG CU\u1ED8C!" : void 0,
      reason: reason || "time_up",
      players: playersArr.map((p) => ({
        id: p.id,
        name: p.name,
        sticker: p.sticker,
        team: p.team,
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
        isBot: p.isBot
      }))
    };
    this.io.to(this.config.id).emit("match_ended", matchEndPayload);
    this.io.to(this.config.id).emit("team_series_ended", matchEndPayload);
    this.io.to(this.config.id).emit("matchEnded", matchEndPayload);
    this.io.to(this.config.id).emit("gameEnded", matchEndPayload);
    this.io.to(this.config.id).emit("gameOver", { winner: this.winner });
    this.status = "gameover";
    this.broadcastState();
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = void 0;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    this.resetTimeout = setTimeout(() => {
      this.returnToWaitingRoom();
    }, 6e3);
  }
  returnToWaitingRoom() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = void 0;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = void 0;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    this.winner = void 0;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.maze = import_physics.PhysicsEngine.generateMaze(9, 7, 100);
    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.status = "waiting";
    for (const player of this.players.values()) {
      const spawn = this.getRandomSpawnPoint();
      player.x = spawn.x;
      player.y = spawn.y;
      player.bodyAngle = Math.random() * Math.PI * 2;
      player.turretAngle = player.bodyAngle;
      player.hp = 1;
      player.maxHp = 1;
      player.alive = true;
      player.isDead = false;
      player.extraLives = 0;
      player.extraLife = false;
      player.activeBulletType = void 0;
      player.specialAmmo = 0;
      player.shieldTimer = void 0;
      player.speedTimer = void 0;
      player.rapidFireTimer = void 0;
      player.activePowerup = void 0;
      player.powerupTimer = void 0;
      player.spawnInvincibleTimer = void 0;
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
    }
    this.io.to(this.config.id).emit("matchReturnedToLobby", { maze: this.maze });
    this.broadcastState();
  }
  update(dt) {
    const now = Date.now();
    if (this.status !== "playing") {
      this.broadcastState();
      return;
    }
    this.timeAccumulator += dt;
    if (this.timeAccumulator >= 1) {
      const secondsToDeduct = Math.floor(this.timeAccumulator);
      this.timeAccumulator -= secondsToDeduct;
      this.matchTimeRemaining = Math.max(0, this.matchTimeRemaining - secondsToDeduct);
      if (this.config.mode !== "teambattle" && this.matchTimeRemaining <= 10 && this.matchTimeRemaining > 0 && this.lastSecondBroadcast !== this.matchTimeRemaining) {
        this.lastSecondBroadcast = this.matchTimeRemaining;
        this.io.to(this.config.id).emit("finalCountdown10s", { remaining: this.matchTimeRemaining });
      }
      if (this.matchTimeRemaining <= 0) {
        this.endMatch("time_up");
        return;
      }
    }
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;
      if (player.isBot) {
        const botInput = import_bot.BotAI.updateBot(
          player,
          Array.from(this.players.values()),
          this.bullets,
          this.maze.walls,
          this.powerups,
          this.maze.width,
          this.maze.height,
          now
        );
        this.processPlayerMovement(player, botInput, dt);
      } else {
        const input = player.currentInput || player.lastInput;
        if (input) {
          const inputAge = now - (player.lastInputTime || 0);
          if (inputAge > 250) {
            input.forward = false;
            input.backward = false;
            input.turnLeft = false;
            input.turnRight = false;
            input.shoot = false;
            input.joystickActive = false;
          }
          this.processPlayerMovement(player, input, dt);
        }
      }
      if (player.shieldTimer && now > player.shieldTimer) {
        player.shieldTimer = void 0;
        if (player.activePowerup === "shield") player.activePowerup = void 0;
      }
      if (player.speedTimer && now > player.speedTimer) {
        player.speedTimer = void 0;
      }
      if (player.rapidFireTimer && now > player.rapidFireTimer) {
        player.rapidFireTimer = void 0;
      }
      if (player.powerupTimer && now > player.powerupTimer) {
        player.activePowerup = void 0;
        player.powerupTimer = void 0;
      }
      if (player.spawnInvincibleTimer && now > player.spawnInvincibleTimer) {
        player.spawnInvincibleTimer = void 0;
      }
    }
    this.laserBeams = this.laserBeams.filter((b) => (b.blastExpiresAt || b.expiresAt || 0) > now);
    const activeBullets = [];
    for (const bullet of this.bullets) {
      const res = import_physics.PhysicsEngine.processBulletRicochet(bullet, this.maze.walls, dt);
      if (res.bounced) {
        this.io.to(this.config.id).emit("bulletBounced", {
          x: res.hitPoint?.x,
          y: res.hitPoint?.y,
          normal: res.normal
        });
      }
      if (bullet.bounces > bullet.maxBounces) {
        continue;
      }
      let destroyed = false;
      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;
        if (bullet.ownerId === player.id && bullet.ignoreOwnerUntil && now < bullet.ignoreOwnerUntil) {
          continue;
        }
        const targetHasShield = player.shieldTimer && now < player.shieldTimer || player.activePowerup === "shield";
        if (targetHasShield) continue;
        if (import_physics.PhysicsEngine.checkCircleCollision({ x: bullet.x, y: bullet.y, radius: bullet.radius }, { x: player.x, y: player.y, radius: player.radius })) {
          const shooter = this.players.get(bullet.ownerId);
          const bulletTeam = bullet.ownerTeam || shooter?.team;
          if (this.config.mode === "teambattle" && bulletTeam && player.team && bulletTeam === player.team && bullet.ownerId !== player.id) {
            continue;
          }
          if (player.extraLives && player.extraLives > 0) {
            player.extraLives -= 1;
            player.extraLife = player.extraLives > 0;
            destroyed = true;
            this.io.to(this.config.id).emit("bulletBounced", {
              x: bullet.x,
              y: bullet.y,
              normal: { x: 0, y: 0 }
            });
            break;
          }
          destroyed = true;
          this.destroyTank(player, shooter);
          break;
        }
      }
      if (!destroyed) {
        activeBullets.push(bullet);
      }
    }
    this.bullets = activeBullets;
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      const expiresAt = p.expiresAt || p.createdAt + 18e3;
      if (now > expiresAt) {
        this.powerups.splice(i, 1);
      }
    }
    if (now - this.lastPowerupSpawn > 1e4 && this.powerups.length < 5) {
      this.lastPowerupSpawn = now;
      this.nextPowerupInterval = 1e4;
      this.spawnPowerup();
    }
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;
        if (import_physics.PhysicsEngine.checkCircleCollision({ x: p.x, y: p.y, radius: 16 }, { x: player.x, y: player.y, radius: player.radius })) {
          let title = "";
          let color = "#38bdf8";
          switch (p.type) {
            // Nhóm 1 - ĐẠN (Cấp 5 viên đạn, ghi đè khi nhặt loại mới, VIẾT HOA TOÀN BỘ)
            case "fastBullet":
              player.activeBulletType = "fastBullet";
              player.specialAmmo = 5;
              player.activePowerup = "fastBullet";
              title = "\u{1F525} \u0110\u1EA0N SI\xCAU T\u1ED0C (5)";
              color = "#ef4444";
              break;
            case "bigBullet":
            case "piercing":
              player.activeBulletType = "bigBullet";
              player.specialAmmo = 5;
              player.activePowerup = "bigBullet";
              title = "\u{1F4A3} \u0110\u1EA0N C\u1EE0 L\u1EDAN (5)";
              color = "#a855f7";
              break;
            case "crazyBounce":
              player.activeBulletType = "crazyBounce";
              player.specialAmmo = 5;
              player.activePowerup = "crazyBounce";
              title = "\u{1FA83} \u0110\u1EA0N SI\xCAU N\u1EA2Y (5)";
              color = "#10b981";
              break;
            case "laser":
              player.activeBulletType = "laser";
              player.specialAmmo = 5;
              player.activePowerup = "laser";
              title = "\u26A1 \u0110\u1EA0N LASER (5)";
              color = "#f87171";
              break;
            // Nhóm 2 - HIỆU ỨNG (Timer 10s, CỘNG DỒN SONG SONG, Viết Hoa Chữ Cái Đầu)
            case "shield":
              player.shieldTimer = now + 1e4;
              player.activePowerup = "shield";
              player.powerupTimer = now + 1e4;
              title = "\u{1F6E1}\uFE0F Khi\xEAn B\u1EA3o V\u1EC7";
              color = "#3b82f6";
              break;
            case "speed":
              player.speedTimer = now + 1e4;
              title = "\u26A1 T\u0103ng T\u1ED1c \u0110\u1ED9";
              color = "#facc15";
              break;
            case "rapidFire":
              player.rapidFireTimer = now + 1e4;
              title = "\u23F1\uFE0F B\u1EAFn Li\xEAn T\u1EE5c";
              color = "#ec4899";
              break;
            // Nhóm 3 - NỘI TẠI (Tác động 1 lần, viết thường toàn bộ)
            case "heart":
            case "extraLife":
              player.extraLives = Math.min(2, (player.extraLives || 0) + 1);
              player.extraLife = true;
              title = "\u2764\uFE0F m\u1EA1ng ph\u1EE5";
              color = "#f43f5e";
              break;
          }
          this.io.to(this.config.id).emit("powerupCollected", {
            playerId: player.id,
            playerName: player.name,
            type: p.type,
            title,
            color,
            x: p.x,
            y: p.y
          });
          this.powerups.splice(i, 1);
          break;
        }
      }
    }
    if (this.config.mode === "teambattle" && this.matchTimeRemaining <= 20 && this.matchTimeRemaining > 0) {
      const centerX = this.maze.width / 2;
      const centerY = this.maze.height / 2;
      const startRadius = Math.hypot(centerX, centerY);
      const t = Math.min(1, Math.max(0, (20 - this.matchTimeRemaining) / 20));
      const currentRadius = Math.max(0, startRadius * (1 - t));
      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;
        const dx = player.x - centerX;
        const dy = player.y - centerY;
        if (dx * dx + dy * dy > currentRadius * currentRadius) {
          this.destroyTank(player);
        }
      }
    }
    if (this.config.mode === "teambattle" && this.status === "playing") {
      this.checkTeamElimination();
    }
    this.broadcastState();
  }
  broadcastState() {
    const now = Date.now();
    const playersList = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      bodyAngle: Math.round(p.bodyAngle * 100) / 100,
      turretAngle: Math.round(p.turretAngle * 100) / 100,
      radius: p.radius,
      color: p.color,
      hp: p.hp,
      alive: (p.hp || 0) > 0 && p.alive !== false && !p.isDead,
      isDead: (p.hp || 0) <= 0 || p.alive === false || !!p.isDead,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
      team: p.team,
      isBot: p.isBot,
      isReady: p.isReady,
      sticker: p.sticker,
      activeBulletType: p.activeBulletType || null,
      specialAmmo: p.specialAmmo ?? 0,
      shieldTimer: p.shieldTimer || 0,
      speedTimer: p.speedTimer || 0,
      rapidFireTimer: p.rapidFireTimer || 0,
      hasShield: p.shieldTimer && now < p.shieldTimer || p.activePowerup === "shield",
      isInvincible: p.spawnInvincibleTimer ? now < p.spawnInvincibleTimer : false,
      extraLife: !!(p.extraLife || p.extraLives && p.extraLives > 0),
      extraLives: p.extraLives || 0,
      activePowerup: p.activePowerup || null,
      currentEmoji: p.currentEmoji && p.emojiExpiresAt > now ? p.currentEmoji : void 0,
      emojiExpiresAt: p.emojiExpiresAt && p.emojiExpiresAt > now ? p.emojiExpiresAt : void 0,
      currentBubble: p.currentBubble && p.bubbleExpiresAt > now ? p.currentBubble : void 0,
      bubbleExpiresAt: p.bubbleExpiresAt && p.bubbleExpiresAt > now ? p.bubbleExpiresAt : void 0
    }));
    const bulletsList = this.bullets.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      x: Math.round(b.x * 10) / 10,
      y: Math.round(b.y * 10) / 10,
      vx: Math.round(b.vx),
      vy: Math.round(b.vy),
      radius: b.radius,
      color: b.color
    }));
    const laserBeamsList = this.laserBeams.map((l) => ({
      id: l.id,
      shooterId: l.shooterId,
      shooterColor: l.shooterColor,
      x1: Math.round(l.x1),
      y1: Math.round(l.y1),
      x2: Math.round(l.x2),
      y2: Math.round(l.y2),
      color: l.color,
      createdAt: l.createdAt,
      chargeUntil: l.chargeUntil,
      blastExpiresAt: l.blastExpiresAt
    }));
    const powerupsList = this.powerups.map((p) => ({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      type: p.type,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt || p.createdAt + 15e3
    }));
    const state = {
      id: this.config.id,
      code: this.config.id,
      tick: this.tickCount++,
      serverTime: now,
      players: playersList,
      bullets: bulletsList,
      laserBeams: laserBeamsList,
      powerups: powerupsList,
      status: this.status,
      matchState: this.status,
      isStarting: this.status === "preparing",
      winner: this.winner,
      hostId: this.hostId,
      ownerId: this.hostId,
      timeRemaining: this.matchTimeRemaining,
      mode: this.config.mode,
      maxPlayers: this.config.maxPlayers || 10,
      boMode: this.boMode,
      seriesScore: this.seriesScore,
      winsNeeded: this.winsNeeded,
      currentRound: this.currentRound,
      startTime: this.startTime,
      freezeUntil: this.freezeUntil,
      isFrozen: this.status !== "playing",
      freezeRemaining: this.status === "preparing" ? Math.max(0, Math.ceil((this.startTime - now) / 1e3)) : 0
    };
    this.io.to(this.config.id).emit("gameState", state);
  }
  /**
   * Sinh sẵn đúng 3 vật phẩm khởi đầu thuộc các loại khác nhau, cách xa điểm xuất phát xe tăng >= 100px
   */
  spawnInitialPowerups() {
    const allTypes = ["fastBullet", "bigBullet", "crazyBounce", "laser", "shield", "speed", "rapidFire", "heart"];
    const count = 3;
    const shuffledTypes = [...allTypes].sort(() => 0.5 - Math.random());
    const selectedTypes = shuffledTypes.slice(0, count);
    const now = Date.now();
    const playerPositions = Array.from(this.players.values()).map((p) => ({ x: p.x, y: p.y }));
    for (const type of selectedTypes) {
      let chosenPos = null;
      let attempts = 0;
      while (attempts < 40) {
        attempts++;
        const pos = this.getRandomSpawnPoint();
        const farFromPlayers = playerPositions.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 100);
        const farFromPowerups = this.powerups.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 90);
        if (farFromPlayers && farFromPowerups) {
          chosenPos = pos;
          break;
        }
      }
      if (!chosenPos) {
        chosenPos = this.getRandomSpawnPoint();
      }
      const powerup = {
        id: `pw_init_${now}_${Math.random()}`,
        x: chosenPos.x,
        y: chosenPos.y,
        type,
        createdAt: now,
        expiresAt: now + 18e3
      };
      this.powerups.push(powerup);
    }
    this.io.to(this.config.id).emit("syncPowerups", { powerups: this.powerups });
  }
  spawnPowerup() {
    const allTypes = ["fastBullet", "bigBullet", "crazyBounce", "laser", "shield", "speed", "rapidFire", "heart"];
    const existingTypes = new Set(this.powerups.map((p) => p.type));
    const unspawnedTypes = allTypes.filter((t) => !existingTypes.has(t));
    const candidateList = unspawnedTypes.length > 0 ? unspawnedTypes : allTypes;
    const selectedType = candidateList[Math.floor(Math.random() * candidateList.length)];
    const now = Date.now();
    let chosenPos = null;
    let attempts = 0;
    const livePlayers = Array.from(this.players.values()).filter((p) => p.hp > 0);
    while (attempts < 30) {
      attempts++;
      const pos = this.getRandomSpawnPoint();
      const farFromPlayers = livePlayers.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 100);
      const farFromPowerups = this.powerups.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 90);
      if (farFromPlayers && farFromPowerups) {
        chosenPos = pos;
        break;
      }
    }
    if (!chosenPos) {
      chosenPos = this.getRandomSpawnPoint();
    }
    const powerup = {
      id: `pw_${now}_${Math.random()}`,
      x: chosenPos.x,
      y: chosenPos.y,
      type: selectedType,
      createdAt: now,
      expiresAt: now + 18e3
    };
    this.powerups.push(powerup);
    this.io.to(this.config.id).emit("powerupSpawned", powerup);
    this.io.to(this.config.id).emit("syncPowerups", { powerups: this.powerups });
  }
  getRandomSpawnPoint() {
    const col = Math.floor(Math.random() * this.maze.cols);
    const row = Math.floor(Math.random() * this.maze.rows);
    return {
      x: col * this.maze.cellSize + this.maze.cellSize / 2,
      y: row * this.maze.cellSize + this.maze.cellSize / 2
    };
  }
  resetMatch() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = void 0;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = void 0;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = void 0;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = void 0;
    }
    this.winner = void 0;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.timeAccumulator = 0;
    this.lastSecondBroadcast = -1;
    this.lastPowerupSpawn = Date.now();
    this.nextPowerupInterval = 1e4;
    this.maze = import_physics.PhysicsEngine.generateMaze(9, 7, 100);
    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;
    if (this.config.boMode === "BO3" || this.config.boMode === "3") {
      this.winsNeeded = 3;
    } else if (this.config.boMode === "BO5" || this.config.boMode === "5") {
      this.winsNeeded = 5;
    } else {
      this.winsNeeded = 1;
    }
    const now = Date.now();
    const bannerDuration = 2e3;
    this.startTime = now + bannerDuration;
    this.freezeUntil = this.startTime;
    this.matchStartTime = this.startTime;
    for (const player of this.players.values()) {
      const spawn = this.getRandomSpawnPoint();
      player.x = spawn.x;
      player.y = spawn.y;
      player.bodyAngle = Math.random() * Math.PI * 2;
      player.turretAngle = player.bodyAngle;
      player.hp = 1;
      player.maxHp = 1;
      player.alive = true;
      player.isDead = false;
      player.extraLives = 0;
      player.extraLife = false;
      player.activeBulletType = void 0;
      player.specialAmmo = 0;
      player.shieldTimer = void 0;
      player.speedTimer = void 0;
      player.rapidFireTimer = void 0;
      player.activePowerup = void 0;
      player.powerupTimer = void 0;
      player.spawnInvincibleTimer = this.startTime + 2500;
      player.currentInput = void 0;
      player.lastInput = void 0;
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
    }
    this.spawnInitialPowerups();
    this.status = "preparing";
    const matchPayload = {
      maze: this.maze,
      config: this.config,
      timeRemaining: this.matchTimeRemaining,
      startTime: this.startTime,
      freezeUntil: this.freezeUntil,
      bannerDuration,
      currentRound: this.currentRound,
      status: "preparing",
      matchState: "preparing",
      isStarting: true
    };
    this.io.to(this.config.id).emit("matchReset", matchPayload);
    this.io.to(this.config.id).emit("matchStarted", matchPayload);
    this.broadcastState();
    this.preparationTimeout = setTimeout(() => {
      try {
        if (this.players.size > 0 && this.status === "preparing") {
          this.status = "playing";
          this.timeAccumulator = 0;
          this.roundStartTime = Date.now();
          this.io.to(this.config.id).emit("matchPlaying", {
            currentRound: this.currentRound,
            timeRemaining: this.matchTimeRemaining,
            status: "playing",
            matchState: "playing"
          });
          this.broadcastState();
        }
      } catch (err) {
        console.error("[Room] Error in preparationTimeout callback (reset match):", err);
      }
    }, bannerDuration);
  }
  getUniqueColor(team) {
    if (team === "red") return TEAM_RED_THEME.body;
    if (team === "blue") return TEAM_BLUE_THEME.body;
    const usedColors = /* @__PURE__ */ new Set();
    for (const p of this.players.values()) {
      if (p.color) {
        usedColors.add(p.color.toLowerCase());
      }
    }
    for (const colDef of TANK_COLORS) {
      if (!usedColors.has(colDef.body.toLowerCase())) {
        return colDef.body;
      }
    }
    return TANK_COLORS[Math.floor(Math.random() * TANK_COLORS.length)].body;
  }
  getRandomColor() {
    return this.getUniqueColor();
  }
}
