/**
 * Tank AZ Online - Server Room Manager
 * Manages game sessions, state sync, room ticks, scoring, and event handling.
 */

import { Server, Socket } from 'socket.io';
import { PhysicsEngine, MazeGrid, WallSegment } from './physics.ts';
import { BotAI, BotState } from './bot.ts';

export interface TankColorDef {
  name: string;
  body: string;
  border: string;
  barrel: string;
}

export const TANK_COLORS: TankColorDef[] = [
  { name: 'Hồng phấn (Pink)',       body: '#f472b6', border: '#db2777', barrel: '#be185d' },
  { name: 'Xanh da trời (Sky)',     body: '#38bdf8', border: '#0284c7', barrel: '#0369a1' },
  { name: 'Vàng bơ (Butter)',       body: '#facc15', border: '#ca8a04', barrel: '#a16207' },
  { name: 'Xanh bạc hà (Mint)',     body: '#4ade80', border: '#16a34a', barrel: '#15803d' },
  { name: 'Tím oải hương (Purple)', body: '#c084fc', border: '#9333ea', barrel: '#7e22ce' },
  { name: 'Cam đào (Peach)',        body: '#fb923c', border: '#ea580c', barrel: '#c2410c' },
  { name: 'Xanh ngọc (Aqua)',       body: '#2dd4bf', border: '#0d9488', barrel: '#115e59' },
  { name: 'Đỏ dâu (Strawberry)',    body: '#fb7185', border: '#e11d48', barrel: '#be123c' },
  { name: 'Vàng chanh (Lime)',      body: '#a3e635', border: '#65a30d', barrel: '#4d7c0f' },
  { name: 'Chàm pastel (Indigo)',   body: '#818cf8', border: '#4f46e5', barrel: '#3730a3' }
];

export const TEAM_RED_THEME = {
  name: 'Đội Đỏ (Strawberry / Dâu Tây Pastel)',
  body: '#fb7185',
  border: '#e11d48',
  barrel: '#be123c',
  treads: '#881337',
  turretBorder: '#9f1239'
};

export const TEAM_BLUE_THEME = {
  name: 'Đội Xanh (Sky Blue / Da Trời Pastel)',
  body: '#38bdf8',
  border: '#0284c7',
  barrel: '#0369a1',
  treads: '#075985',
  turretBorder: '#0c4a6e'
};

export interface PlayerInput {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  turretAngle?: number;
  shoot: boolean;
  joystickActive?: boolean;
  targetAngle?: number;
  intensity?: number;
}

export interface PlayerData extends BotState {
  socketId?: string;
  isReady: boolean;
  lives: number;
  extraLives: number;
  sticker?: string;
  spawnInvincibleTimer?: number;
  currentEmote?: string;
  emoteExpiresAt?: number;
  currentInput?: PlayerInput;
  lastInputTime?: number;
  lastInput?: PlayerInput;
}

export interface BulletData {
  id: string;
  ownerId: string;
  ownerName: string;
  ownerTeam?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  bounces: number;
  maxBounces: number;
  color: string;
  createdAt?: number;
  ignoreOwnerUntil?: number;
}

export interface LaserBeamData {
  id: string;
  shooterId: string;
  shooterColor?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  createdAt: number;
  expiresAt?: number;
  chargeUntil?: number;
  blastExpiresAt?: number;
  hasDealtDamage: boolean;
}

export interface PowerupData {
  id: string;
  x: number;
  y: number;
  type: 'speed' | 'fastBullet' | 'bigBullet' | 'shield' | 'rapidFire' | 'crazyBounce' | 'laser' | 'heart' | 'extraLife' | 'piercing';
  createdAt: number;
  expiresAt?: number;
}

export interface RoomConfig {
  id: string;
  name: string;
  password?: string;
  mode: 'deathmatch' | 'teambattle' | 'botbattle' | 'survival';
  maxPlayers: number;
  matchDuration?: number;
  botCount: number;
  botDifficulty: 'easy' | 'medium' | 'hard';
  scoreToWin?: number;
  boMode?: string;
}

export class GameRoom {
  config: RoomConfig;
  players: Map<string, PlayerData> = new Map();
  bullets: BulletData[] = [];
  laserBeams: LaserBeamData[] = [];
  powerups: PowerupData[] = [];
  maze: MazeGrid;
  status: 'waiting' | 'preparing' | 'playing' | 'round_paused' | 'finished' | 'gameover' = 'waiting';
  winner?: { id: string; name: string; score: number };
  hostId?: string;
  chatHistory: Array<{ senderId: string; senderName: string; senderSticker: string; message: string; emote: string; timestamp: number }> = [];

  boMode: string = 'BO1';
  seriesScore: { red: number; blue: number } = { red: 0, blue: 0 };
  winsNeeded: number = 1;
  currentRound: number = 1;
  startTime: number = 0;
  freezeUntil: number = 0;
  private preparationTimeout?: NodeJS.Timeout;
  private roundEndingTimeout?: NodeJS.Timeout;
  private roundObservationTimeout?: NodeJS.Timeout;
  private roundStartTime: number = Date.now();

  matchStartTime: number = Date.now();
  matchTimeRemaining: number = 180;
  private timeAccumulator: number = 0;
  private lastSecondBroadcast: number = -1;
  
  private io: Server;
  private intervalId?: NodeJS.Timeout;
  private resetTimeout?: NodeJS.Timeout;
  private lastPowerupSpawn: number = 0;
  private nextPowerupInterval: number = 15000;
  private bulletIdCounter: number = 0;
  private tickCount: number = 0;

  constructor(config: RoomConfig, io: Server) {
    var rawDur = (config && typeof config.matchDuration === 'number' && config.matchDuration > 0) ? config.matchDuration : 180;
    var durationSec = rawDur <= 30 ? rawDur * 60 : rawDur;
    config.matchDuration = durationSec;

    this.config = config;
    this.io = io;
    this.maze = PhysicsEngine.generateMaze(9, 7, 100);
    this.matchStartTime = Date.now();
    this.roundStartTime = Date.now();
    this.matchTimeRemaining = durationSec;
    this.timeAccumulator = 0;
    this.nextPowerupInterval = 10000;

    this.boMode = (config && config.boMode) ? config.boMode : 'BO1';
    if (this.boMode === 'BO3' || this.boMode === '3') {
      this.winsNeeded = 3;
    } else if (this.boMode === 'BO5' || this.boMode === '5') {
      this.winsNeeded = 5;
    } else {
      this.winsNeeded = 1;
    }
    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;

    // Sinh sẵn 3 vật phẩm khác loại cho phòng mới tạo
    this.spawnInitialPowerups();

    this.startLoop();
  }

  public updateHost() {
    const humans = Array.from(this.players.values()).filter((p) => !p.isBot);
    if (humans.length > 0) {
      if (!this.hostId || !humans.some((p) => p.id === this.hostId)) {
        this.hostId = humans[0].id;
      }
    } else {
      this.hostId = undefined;
    }
  }

  public destroy() {
    this.stopLoop();
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = undefined;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = undefined;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }
    this.players.clear();
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
  }

  public addPlayer(socket: Socket, name: string, sticker?: string): PlayerData {
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

    let team: 'red' | 'blue' | 'none' | undefined = undefined;
    if (this.config.mode === 'teambattle') {
      const redCount = Array.from(this.players.values()).filter((p) => p.team === 'red').length;
      const blueCount = Array.from(this.players.values()).filter((p) => p.team === 'blue').length;
      team = redCount <= blueCount ? 'red' : 'blue';
    }

    const spawnPoint = this.getRandomSpawnPoint();
    const playerSticker = sticker || (socket as any).playerSticker || '🐥';

    const player: PlayerData = {
      id: socket.id,
      socketId: socket.id,
      name: name || `Tank_${socket.id.substring(0, 4)}`,
      sticker: playerSticker,
      difficulty: 'easy',
      x: spawnPoint.x,
      y: spawnPoint.y,
      bodyAngle: Math.random() * Math.PI * 2,
      turretAngle: 0,
      radius: 18,
      moveSpeed: 150,
      turnRate: 2.0,
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
      shootCooldown: 1.0,
      isReady: true,
      specialAmmo: 0,
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

  public startMatch(): { success: boolean; error?: string } {
    if (this.config.mode === 'teambattle') {
      const redCount = Array.from(this.players.values()).filter((p) => p.team === 'red').length;
      const blueCount = Array.from(this.players.values()).filter((p) => p.team === 'blue').length;
      if (redCount < 1 || blueCount < 1) {
        const errorMsg = 'Cả Đội Đỏ và Đội Xanh đều phải có ít nhất 1 thành viên để bắt đầu trận đấu!';
        this.io.to(this.config.id).emit('roomError', errorMsg);
        this.io.to(this.config.id).emit('errorMessage', errorMsg);
        return { success: false, error: errorMsg };
      }
    }
    this.resetMatch();
    return { success: true };
  }

  public startGame() {
    this.resetMatch();
  }

  public startRound() {
    this.resetMatch();
  }

  public resetGame() {
    this.resetMatch();
  }

  public removePlayer(socketId: string) {
    this.players.delete(socketId);
    this.updateHost();
    this.adjustBots();
    this.broadcastState();

    const humanCount = Array.from(this.players.values()).filter((p) => !p.isBot).length;
    if (humanCount === 0) {
      this.stopLoop();
    } else if (this.status === 'playing' && this.config.mode === 'teambattle') {
      this.checkTeamElimination();
    }
  }

  public switchTeam(socketId: string, team: 'red' | 'blue') {
    const player = this.players.get(socketId);
    if (player && this.config.mode === 'teambattle') {
      player.team = team;
      player.color = this.getUniqueColor(team);
      this.broadcastState();
    }
  }

  public addBotToTeam(team?: string, difficulty?: string) {
    if (this.players.size >= (this.config.maxPlayers || 10)) return;

    let botTeam: 'red' | 'blue' | 'none' | undefined = undefined;
    if (team === 'red' || team === 'blue') {
      botTeam = team;
    } else if (team === 'none' || team === 'deathmatch') {
      botTeam = 'none';
    }

    const allBots = Array.from(this.players.values()).filter((p) => p.isBot);
    const botNum = allBots.length + 1;

    const botStickers = ['🤖', '🐥', '🐱', '⭐', '🌱', '🌸', '🐰', '❤️'];
    const botSticker = botStickers[(botNum - 1) % botStickers.length];

    let botName = `Bot AI ${botNum}`;
    let color = this.getUniqueColor(undefined);

    if (botTeam === 'red') {
      const redBots = allBots.filter((p) => p.team === 'red');
      botName = `Bot Đỏ ${redBots.length + 1}`;
      color = TEAM_RED_THEME.body;
    } else if (botTeam === 'blue') {
      const blueBots = allBots.filter((p) => p.team === 'blue');
      botName = `Bot Xanh ${blueBots.length + 1}`;
      color = TEAM_BLUE_THEME.body;
    }

    const botId = `bot_${botTeam || 'dm'}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const spawnPoint = this.getRandomSpawnPoint();

    const botPlayer: PlayerData = {
      id: botId,
      name: botName,
      sticker: botSticker,
      difficulty: difficulty || 'smart',
      x: spawnPoint.x,
      y: spawnPoint.y,
      bodyAngle: Math.random() * Math.PI * 2,
      turretAngle: 0,
      radius: 18,
      moveSpeed: 150,
      turnRate: 2.0,
      isBot: true,
      color: color,
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
      shootCooldown: 1.0,
      isReady: true,
      specialAmmo: 0,
    };

    this.players.set(botId, botPlayer);
    this.broadcastState();
  }

  public removeBotFromTeam(team?: string) {
    let botsToRemove = Array.from(this.players.values()).filter((p) => p.isBot);
    if (team === 'red' || team === 'blue') {
      botsToRemove = botsToRemove.filter((p) => p.team === team);
    } else if (team === 'none' || team === 'deathmatch') {
      botsToRemove = botsToRemove.filter((p) => !p.team || p.team === 'none');
    }
    if (botsToRemove.length === 0) return;
    const botToRemove = botsToRemove[botsToRemove.length - 1];
    this.players.delete(botToRemove.id);
    this.broadcastState();
  }

  private adjustBots() {
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

  public getPlayerBySocketId(socketId: string): PlayerData | undefined {
    const player = this.players.get(socketId);
    if (player) return player;
    return Array.from(this.players.values()).find((p) => p.socketId === socketId || p.id === socketId);
  }

  public handleChat(socketId: string, msg: string, emote?: string) {
    const senderPlayer = this.getPlayerBySocketId(socketId);
    const senderId = senderPlayer ? senderPlayer.id : socketId;
    const senderName = senderPlayer ? senderPlayer.name : 'Vô danh';
    const senderSticker = senderPlayer ? (senderPlayer as any).sticker || '🐥' : '🐥';
    const senderColor = senderPlayer ? senderPlayer.color : '#38bdf8';

    const chatPayload = {
      senderId: senderId,
      playerId: senderId,
      senderName: senderName,
      senderSticker: senderSticker,
      senderColor: senderColor,
      message: msg || '',
      emote: emote || '',
      emoji: emote || msg || '',
      timestamp: Date.now(),
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

    // Broadcast chat to the entire room including sender
    this.io.to(this.config.id).emit('chatMessage', chatPayload);

    if (emote) {
      const expiresAt = Date.now() + 2500;
      if (senderPlayer) {
        (senderPlayer as any).currentEmoji = emote;
        (senderPlayer as any).emojiExpiresAt = expiresAt;
      }
      this.io.to(this.config.id).emit('playerEmoji', {
        playerId: senderId,
        emoji: emote,
        expiresAt: expiresAt,
      });
    }
  }

  public handleEmoji(socketId: string, emoji: string) {
    const senderPlayer = this.getPlayerBySocketId(socketId);
    const senderId = senderPlayer ? senderPlayer.id : socketId;
    const expiresAt = Date.now() + 2500;

    if (senderPlayer) {
      (senderPlayer as any).currentEmoji = emoji;
      (senderPlayer as any).emojiExpiresAt = expiresAt;
    }

    this.io.to(this.config.id).emit('playerEmoji', {
      playerId: senderId,
      emoji: emoji,
      expiresAt: expiresAt,
    });
  }

  public handlePlayerInput(socketId: string, input: PlayerInput) {
    const player = this.players.get(socketId);
    if (!player || player.hp <= 0 || this.status !== 'playing') return;

    // Non-blocking input update: Store intent without executing physics or broadcasting
    player.currentInput = {
      forward: !!input.forward,
      backward: !!input.backward,
      turnLeft: !!input.turnLeft,
      turnRight: !!input.turnRight,
      turretAngle: typeof input.turretAngle === 'number' ? input.turretAngle : (player.turretAngle || 0),
      shoot: !!input.shoot,
      joystickActive: !!input.joystickActive,
      targetAngle: typeof input.targetAngle === 'number' ? input.targetAngle : 0,
      intensity: typeof input.intensity === 'number' ? Math.max(0, Math.min(1, input.intensity)) : 0,
    };
    player.lastInputTime = Date.now();
  }

  private processPlayerMovement(player: PlayerData, input: any, dt: number) {
    if (this.status !== 'playing' || player.hp <= 0) return;

    const now = Date.now();
    const isSpeed = (player.speedTimer && now < player.speedTimer) || player.activePowerup === 'speed';
    const speed = isSpeed ? player.moveSpeed * 1.4 : player.moveSpeed;

    if (input && input.joystickActive && typeof input.intensity === 'number' && input.intensity > 0) {
      const targetAngle = typeof input.targetAngle === 'number' ? input.targetAngle : 0;
      const intensity = Math.min(1, Math.max(0, input.intensity));

      player.bodyAngle = targetAngle;
      player.turretAngle = targetAngle;

      const moveX = Math.cos(targetAngle) * speed * intensity * dt;
      const moveY = Math.sin(targetAngle) * speed * intensity * dt;

      const newPos = { x: player.x + moveX, y: player.y + moveY, radius: player.radius };

      for (const wall of this.maze.walls) {
        const res = PhysicsEngine.resolveCircleWallCollision(newPos, wall);
        if (res.collided) {
          newPos.x = res.x;
          newPos.y = res.y;
        }
      }

      player.x = Math.max(player.radius, Math.min(this.maze.width - player.radius, newPos.x));
      player.y = Math.max(player.radius, Math.min(this.maze.height - player.radius, newPos.y));
    } else {
      const turnRate = player.turnRate || 2.0; // radians/sec

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
        const res = PhysicsEngine.resolveCircleWallCollision(newPos, wall);
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

  private fireBullet(player: PlayerData) {
    if (this.status !== 'playing' || player.hp <= 0) return;

    const now = Date.now();
    const hasSpecialAmmo = Boolean(player.activeBulletType && (player.specialAmmo === undefined || player.specialAmmo > 0));
    const bulletType = hasSpecialAmmo ? player.activeBulletType : undefined;

    const isRapid = (player.rapidFireTimer && now < player.rapidFireTimer) || player.activePowerup === 'rapidFire';
    const isLaser = bulletType === 'laser' || player.activeBulletType === 'laser' || player.activePowerup === 'laser';

    // Thời gian nạp đạn (shootCooldown):
    // Khi đang sở hữu buff Laser: 0.9s (900ms) theo yêu cầu để nạp đạn rõ ràng, chống spam liên tục
    // Khi có buff Bắn nhanh (Rapid Fire): 0.4s (400ms)
    // Mặc định: 1.0s (1000ms) cố định
    let cd = 1.0;
    if (isLaser) {
      cd = 0.9; // 900ms
    } else if (isRapid) {
      cd = 0.4; // 400ms
    }

    const lastFired = (player as any).lastFireTime || player.lastShotTime || 0;
    if (now - lastFired < cd * 1000) return;

    // Nhóm 1 - ĐẠN: Cơ chế đếm 5 viên
    if (bulletType) {
      player.specialAmmo = (player.specialAmmo !== undefined ? player.specialAmmo : 5) - 1;
      if (player.specialAmmo <= 0) {
        player.activeBulletType = undefined;
        player.specialAmmo = 0;
        if (player.activePowerup === bulletType) {
          player.activePowerup = undefined;
        }
      }
    }

    player.lastShotTime = now;
    (player as any).lastFireTime = now;

    // ⚡ ĐẠN LASER: BƯỚC 1 (0ms) Tia nhỏ chỉ thị ngắm bắn 120ms (0 sát thương) -> BƯỚC 2 (Sau 120ms) gọi triggerLaserBlastDamage quét chết mục tiêu và phát laserBlasted hiển thị tia to 160ms
    if (bulletType === 'laser') {
      const barrelLen = player.radius + 14;
      const bx = player.x + Math.cos(player.turretAngle) * barrelLen;
      const by = player.y + Math.sin(player.turretAngle) * barrelLen;

      // Analytical raycast calculation strictly avoiding while loops
      const hitResult = PhysicsEngine.raycastLaser(
        bx,
        by,
        player.turretAngle,
        this.maze.walls,
        this.maze.width,
        this.maze.height,
        2000
      );

      const laserAimDuration = 120; // 120ms: Tia ngắm cảnh báo màu đỏ mảnh, KHÔNG gây sát thương
      const laserBlastDuration = 160; // 160ms: Tia to cực đại bùng nổ
      const beamId = `laser_${this.bulletIdCounter++}_${now}`;
      const laserBeam: LaserBeamData = {
        id: beamId,
        shooterId: player.id,
        shooterColor: player.color,
        x1: bx,
        y1: by,
        x2: hitResult.x,
        y2: hitResult.y,
        color: '#ef4444',
        createdAt: now,
        chargeUntil: now + laserAimDuration,
        blastExpiresAt: now + laserAimDuration + laserBlastDuration,
        expiresAt: now + laserAimDuration + laserBlastDuration,
        hasDealtDamage: false,
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
        color: '#ef4444',
        createdAt: now,
        aimDuration: 120,
        blastDuration: 160,
      };

      // BƯỚC 1 (0ms): Phát sự kiện 'laserAiming' để Client vẽ ngay Tia Nhỏ 120ms (TUYỆT ĐỐI 0 sát thương, KHÔNG vẽ tia to)
      this.io.to(this.config.id).emit('laserAiming', laserPayload);

      // BƯỚC 2 (Sau 120ms): Kích hoạt tính sát thương Raycast và phát 'laserBlasted' cho Client vẽ Tia To
      setTimeout(() => {
        try {
          this.triggerLaserBlastDamage(player, player.turretAngle, bx, by, hitResult.x, hitResult.y, laserBeam.id);
        } catch (err) {
          console.error('[Room] Error in triggerLaserBlastDamage callback:', err);
        }
      }, 120);

      return;
    }

    // Nhóm 1: 🔥 ĐẠN SIÊU TỐC, 💣 ĐẠN CỠ LỚN, 🪃 ĐẠN SIÊU NẢY, hoặc đạn thường
    const isFast = bulletType === 'fastBullet';
    const isBig = bulletType === 'bigBullet' || bulletType === 'piercing';
    const isBounce = bulletType === 'crazyBounce' || bulletType === 'bounce' || bulletType === 'ricochet';

    // Sửa lỗi tự nổ: offset xa hơn cho đạn cỡ lớn
    const barrelLen = isBig ? player.radius + 18 : player.radius + 12;
    const bulletX = player.x + Math.cos(player.turretAngle) * barrelLen;
    const bulletY = player.y + Math.sin(player.turretAngle) * barrelLen;

    const bulletSpeed = isFast ? 520 : 380;
    const vx = Math.cos(player.turretAngle) * bulletSpeed;
    const vy = Math.sin(player.turretAngle) * bulletSpeed;

    const bullet: BulletData = {
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
      color: isFast ? '#ef4444' : isBig ? '#a855f7' : isBounce ? '#10b981' : '#facc15',
      createdAt: now,
      ignoreOwnerUntil: isBig ? now + 120 : now + 60, // Bỏ qua va chạm người bắn 120ms đầu
    };

    this.bullets.push(bullet);

    // Notify clients of bullet fire event
    this.io.to(this.config.id).emit('bulletFired', {
      x: bulletX,
      y: bulletY,
      angle: player.turretAngle,
      ownerId: player.id,
      color: bullet.color,
      radius: bullet.radius,
    });
  }

  private startLoop() {
    const tickRate = 30; // 30 Hz updates
    const dt = 1 / tickRate;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.intervalId = setInterval(() => {
      if (this.status === 'playing') {
        this.update(dt);
      } else if (this.players.size > 0) {
        this.broadcastState();
      } else {
        // Room is empty -> stop loop to prevent CPU waste
        this.stopLoop();
      }
    }, 1000 / tickRate);
  }

  private stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  public triggerLaserBlastDamage(player: any, angle: number, startX: number, startY: number, targetX?: number, targetY?: number, beamId?: string) {
    if (!player || (this.status !== 'playing' && this.status !== 'round_paused')) return;

    let endX = targetX;
    let endY = targetY;

    if (endX === undefined || endY === undefined) {
      const hitResult = PhysicsEngine.raycastLaser(
        startX,
        startY,
        angle,
        this.maze.walls,
        this.maze.width,
        this.maze.height,
        2000
      );
      endX = hitResult.x;
      endY = hitResult.y;
    }

    const now = Date.now();
    const beam = this.laserBeams.find((b) => b.id === beamId);
    if (beam) {
      beam.hasDealtDamage = true;
    }

    // Báo hiệu nổ chớp laser cho các client
    this.io.to(this.config.id).emit('laserBlasted', {
      id: beamId || `blast_${now}`,
      shooterId: player.id,
      x1: startX,
      y1: startY,
      x2: endX,
      y2: endY,
    });

    const shooter = this.players.get(player.id) || player;

    for (const tank of this.players.values()) {
      if (tank.id === player.id || tank.hp <= 0) continue;

      // Cấm Friendly Fire trong chế độ Team
      if (this.config.mode === 'teambattle' && shooter?.team && tank.team && shooter.team === tank.team) {
        continue;
      }

      // Nhóm 2 - 🛡️ Khiên Bảo Vệ & Bất tử: Miễn nhiễm hoàn toàn với Laser
      const targetIsImmune = (tank.shieldTimer && now < tank.shieldTimer) ||
        tank.activePowerup === 'shield' ||
        (tank.spawnInvincibleTimer && now < tank.spawnInvincibleTimer);
      if (targetIsImmune) continue;

      const dist = PhysicsEngine.distToSegment({ x: tank.x, y: tank.y }, { x: startX, y: startY }, { x: endX, y: endY });
      if (dist <= tank.radius + 14) {
        // Nhóm 3 - ❤️ mạng phụ: Đỡ 1 phát đạn chí mạng cứu sống tại chỗ
        if (tank.extraLives && tank.extraLives > 0) {
          tank.extraLives -= 1;
          tank.extraLife = tank.extraLives > 0;
          this.io.to(this.config.id).emit('bulletBounced', {
            x: tank.x,
            y: tank.y,
            normal: { x: 0, y: -1 },
          });
        } else {
          this.destroyTank(tank, shooter);
        }
      }
    }
  }

  public destroyTank(player: PlayerData, shooter?: PlayerData) {
    player.hp = 0;
    player.alive = false;
    player.isDead = true;
    player.activeBulletType = undefined;
    player.specialAmmo = 0;
    player.shieldTimer = undefined;
    player.speedTimer = undefined;
    player.rapidFireTimer = undefined;
    player.activePowerup = undefined;
    player.powerupTimer = undefined;
    player.extraLife = false;
    player.extraLives = 0;
    player.deaths += 1;
    player.score = Math.max(0, (player.kills * 100) - (player.deaths * 50));

    if (shooter) {
      if (shooter.id !== player.id) {
        shooter.kills += 1;
        shooter.score = Math.max(0, (shooter.kills * 100) - (shooter.deaths * 50));
      } else {
        // Self kill penalty
        shooter.score = Math.max(0, (shooter.kills * 100) - (shooter.deaths * 50));
      }
    }

    // Trigger explosion event
    this.io.to(this.config.id).emit('tankExploded', {
      x: player.x,
      y: player.y,
      playerName: player.name,
      color: player.color,
    });

    if (this.config.mode === 'teambattle') {
      // In team battle, no mid-round respawn: immediately check if a team is eliminated
      this.checkTeamElimination();
    } else {
      // Schedule respawn after 2.5 seconds if game continues (for Deathmatch)
      setTimeout(() => {
        if (this.players.has(player.id) && this.status === 'playing') {
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

  public checkTeamElimination() {
    if (this.status !== 'playing' || this.config.mode !== 'teambattle') return;

    const playersArr = Array.from(this.players.values());
    const redPlayers = playersArr.filter((p) => p.team === 'red');
    const bluePlayers = playersArr.filter((p) => p.team === 'blue');

    if (redPlayers.length > 0 && bluePlayers.length > 0) {
      const redAlive = redPlayers.filter((p) => (p.hp || 0) > 0 && p.alive !== false && !p.isDead).length;
      const blueAlive = bluePlayers.filter((p) => (p.hp || 0) > 0 && p.alive !== false && !p.isDead).length;

      if (redAlive === 0 && blueAlive > 0) {
        this.handleTeamRoundEnd('blue');
      } else if (blueAlive === 0 && redAlive > 0) {
        this.handleTeamRoundEnd('red');
      } else if (redAlive === 0 && blueAlive === 0) {
        this.handleTeamRoundEnd('draw');
      }
    } else if (Date.now() - this.roundStartTime > 2000) {
      // Chỉ xử forfeit nếu trận đã diễn ra > 2s và một đội thoát hết
      if (redPlayers.length > 0 && bluePlayers.length === 0) {
        this.handleTeamRoundEnd('red', true);
      } else if (bluePlayers.length > 0 && redPlayers.length === 0) {
        this.handleTeamRoundEnd('blue', true);
      }
    }
  }

  public handleTeamRoundEnd(winningTeam: 'red' | 'blue' | 'draw', isForfeit: boolean = false) {
    if (this.status !== 'playing') return;

    // 1. Dừng ngay lập tức chuyển động và đạn
    this.status = 'round_paused';
    this.bullets = [];
    this.laserBeams = [];

    // Cộng điểm cho đội thắng ván
    if (winningTeam === 'red') {
      this.seriesScore.red += 1;
    } else if (winningTeam === 'blue') {
      this.seriesScore.blue += 1;
    }

    // Kiểm tra ngay điều kiện thắng cả trận (Series Win)
    const isMatchOver = isForfeit ||
      this.seriesScore.red >= this.winsNeeded ||
      this.seriesScore.blue >= this.winsNeeded ||
      (this.winsNeeded === 1 && winningTeam !== 'draw');

    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }

    const delaySeconds = 3;
    const roundPayload = {
      roundWinnerTeam: winningTeam,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      currentRound: this.currentRound,
      delaySeconds: delaySeconds,
      isMatchOver: isMatchOver,
    };

    // Gửi sự kiện xuống Client để hiển thị thông báo kết quả hiệp đấu vừa xong trên Canvas
    this.io.to(this.config.id).emit('roundEnding', roundPayload);
    this.io.to(this.config.id).emit('roundEnded', roundPayload);
    this.broadcastState();

    if (isMatchOver) {
      // Đóng băng hiện trường trong đúng 3 giây để người chơi quan sát lại tình huống vừa xảy ra.
      // Trong 3 giây này, CHỈ hiển thị dòng chữ canvas thông báo kết quả của hiệp đấu cuối đó.
      // TUYỆT ĐỐI CHƯA mở Bảng Vinh Danh (Modal MVP) ngay lập tức.
      // Sau khi hết 3 giây đóng băng, mới gọi endMatch để phát matchEnded / gameEnded kích hoạt Bảng Vinh Danh.
      this.roundObservationTimeout = setTimeout(() => {
        try {
          if (this.players.size > 0 && this.status === 'round_paused') {
            let finalWinnerTeam = winningTeam;
            if (finalWinnerTeam === 'draw') {
              if (this.seriesScore.red > this.seriesScore.blue) finalWinnerTeam = 'red';
              else if (this.seriesScore.blue > this.seriesScore.red) finalWinnerTeam = 'blue';
            }
            this.endMatch(isForfeit ? 'opponent_forfeit' : 'team_eliminated', undefined, finalWinnerTeam);
          }
        } catch (err) {
          console.error('[Room] Error during endMatch after 3s freeze:', err);
        }
      }, delaySeconds * 1000);
    } else {
      // THẮNG 1 HIỆP -> Đóng băng chuyển động/đạn 3 giây, sau đó sang hiệp tiếp theo
      this.roundEndingTimeout = setTimeout(() => {
        try {
          if (this.players.size > 0 && (this.status === 'round_paused' || this.status === 'playing')) {
            this.startNextRound();
          }
        } catch (err) {
          console.error('[Room] Error during startNextRound in roundEndingTimeout:', err);
        }
      }, delaySeconds * 1000);
    }
  }

  public startNextRound() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = undefined;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }

    this.currentRound += 1;
    this.winner = undefined;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.timeAccumulator = 0;
    this.lastSecondBroadcast = -1;
    this.lastPowerupSpawn = Date.now();
    this.nextPowerupInterval = 10000;
    this.maze = PhysicsEngine.generateMaze(9, 7, 100);

    const now = Date.now();
    const bannerDuration = 2000;
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
      player.activeBulletType = undefined;
      player.specialAmmo = 0;
      player.shieldTimer = undefined;
      player.speedTimer = undefined;
      player.rapidFireTimer = undefined;
      player.activePowerup = undefined;
      player.powerupTimer = undefined;
      player.spawnInvincibleTimer = this.startTime + 2500;
      player.currentInput = undefined;
      player.lastInput = undefined;
    }

    this.spawnInitialPowerups();
    // Trạng thái chuẩn bị: Đóng băng đồng hồ, khóa di chuyển & bắn, vẽ banner thông báo
    this.status = 'preparing';

    this.io.to(this.config.id).emit('nextRoundStarted', {
      maze: this.maze,
      currentRound: this.currentRound,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      timeRemaining: this.matchTimeRemaining,
      startTime: this.startTime,
      freezeUntil: this.freezeUntil,
      bannerDuration: bannerDuration,
      status: 'preparing',
      matchState: 'preparing',
      isStarting: true,
    });
    this.broadcastState();

    // Đúng sau 2 giây chuẩn bị: Chuyển sang 'playing', ẩn banner, bắt đầu trừ giây đồng hồ và mở khóa điều khiển
    this.preparationTimeout = setTimeout(() => {
      try {
        if (this.players.size > 0 && this.status === 'preparing') {
          this.status = 'playing';
          this.timeAccumulator = 0;
          this.roundStartTime = Date.now();
          this.io.to(this.config.id).emit('matchPlaying', {
            currentRound: this.currentRound,
            timeRemaining: this.matchTimeRemaining,
            status: 'playing',
            matchState: 'playing',
          });
          this.broadcastState();
        }
      } catch (err) {
        console.error('[Room] Error in preparationTimeout callback (next round):', err);
      }
    }, bannerDuration);
  }

  public endMatch(reason?: string, specificWinner?: any, specificWinningTeam?: 'red' | 'blue' | 'draw') {
    if (this.status === 'finished' || this.status === 'gameover') return;
    this.status = 'finished';

    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }

    const playersArr = Array.from(this.players.values());

    // Stop and clear in-flight projectiles
    this.bullets = [];
    this.laserBeams = [];

    // Calculate MVP & Win details
    let mvp: any = null;
    let winner: any = specificWinner || this.winner;
    let winningTeam: 'red' | 'blue' | 'draw' | undefined = specificWinningTeam;
    let winningMembers: string[] = [];

    if (this.config.mode === 'teambattle') {
      const redPlayers = playersArr.filter((p) => p.team === 'red');
      const bluePlayers = playersArr.filter((p) => p.team === 'blue');

      const redKills = redPlayers.reduce((acc, p) => acc + (p.kills || 0), 0);
      const blueKills = bluePlayers.reduce((acc, p) => acc + (p.kills || 0), 0);

      const redAlive = redPlayers.filter((p) => p.hp > 0).length;
      const blueAlive = bluePlayers.filter((p) => p.hp > 0).length;

      if (!winningTeam) {
        if (this.seriesScore.red > this.seriesScore.blue) {
          winningTeam = 'red';
        } else if (this.seriesScore.blue > this.seriesScore.red) {
          winningTeam = 'blue';
        } else if (redAlive > 0 && blueAlive === 0) {
          winningTeam = 'red';
        } else if (blueAlive > 0 && redAlive === 0) {
          winningTeam = 'blue';
        } else if (redKills > blueKills) {
          winningTeam = 'red';
        } else if (blueKills > redKills) {
          winningTeam = 'blue';
        } else {
          winningTeam = 'draw';
        }
      }

      const winningPlayerList = winningTeam === 'red' ? redPlayers : winningTeam === 'blue' ? bluePlayers : [];
      winningMembers = winningPlayerList.map((p) => {
        const killCount = p.kills || 0;
        const prefix = p.isBot ? '🤖' : '👑';
        return `${prefix} ${p.name} (${killCount} Kills)`;
      });
    }

    const winnersList = (winningTeam === 'red' || winningTeam === 'blue')
      ? playersArr
          .filter((p) => p.team === winningTeam)
          .map((p) => ({
            name: p.name,
            kills: p.kills || 0,
            deaths: p.deaths || 0,
            score: p.score || 0,
            isBot: !!p.isBot,
            sticker: p.sticker || (p.isBot ? '🤖' : '🐥'),
          }))
      : [];

    // Determine Top MVP player across room
    if (playersArr.length > 0) {
      const sortedByScore = [...playersArr].sort((a, b) => {
        const scoreA = Math.max(0, a.score !== undefined ? a.score : (a.kills || 0) * 100 - (a.deaths || 0) * 50);
        const scoreB = Math.max(0, b.score !== undefined ? b.score : (b.kills || 0) * 100 - (b.deaths || 0) * 50);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.kills || 0) - (a.kills || 0);
      });

      const top = sortedByScore[0];
      const topScore = Math.max(0, top.score !== undefined ? top.score : (top.kills || 0) * 100 - (top.deaths || 0) * 50);
      mvp = {
        id: top.id,
        name: top.name,
        sticker: top.sticker || (top.isBot ? '🤖' : '🐥'),
        score: topScore,
        kills: top.kills || 0,
        deaths: top.deaths || 0,
        team: top.team,
      };

      if (!winner) {
        winner = { id: top.id, name: top.name, score: topScore };
      }
    } else {
      mvp = { name: 'Người chơi', sticker: '🐥', score: 0, kills: 0, deaths: 0 };
    }

    this.winner = winner;

    const matchEndPayload = {
      type: 'match_ended',
      roomName: this.config.name,
      mode: this.config.mode,
      winner: this.winner,
      mvp: mvp,
      winnerTeam: winningTeam,
      winningTeam: winningTeam,
      winningMembers: winningMembers,
      winners: winnersList,
      members: winnersList,
      finalScore: this.seriesScore,
      seriesScore: this.seriesScore,
      boMode: this.boMode,
      winsNeeded: this.winsNeeded,
      forfeitMessage: (reason === 'opponent_forfeit') ? 'ĐỐI THỦ ĐÃ THOÁT TRẬN! ĐỘI BẠN THẮNG CHUNG CUỘC!' : undefined,
      reason: reason || 'time_up',
      players: playersArr.map((p) => ({
        id: p.id,
        name: p.name,
        sticker: p.sticker,
        team: p.team,
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
        isBot: p.isBot,
      })),
    };

    // Emit all match end event variants to ensure all clients catch it
    this.io.to(this.config.id).emit('match_ended', matchEndPayload);
    this.io.to(this.config.id).emit('team_series_ended', matchEndPayload);
    this.io.to(this.config.id).emit('matchEnded', matchEndPayload);
    this.io.to(this.config.id).emit('gameEnded', matchEndPayload);
    this.io.to(this.config.id).emit('gameOver', { winner: this.winner });

    // Đặt trạng thái phòng là 'gameover' trong 6 giây để người chơi xem trọn vẹn thông báo đội chiến thắng và vinh danh
    this.status = 'gameover';
    this.broadcastState();

    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = undefined;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }

    // Sau 6 giây vinh danh kết thúc, chuyển trạng thái về 'waiting' (phòng chờ) để chủ phòng bấm bắt đầu lại
    this.resetTimeout = setTimeout(() => {
      this.returnToWaitingRoom();
    }, 6000);
  }

  public returnToWaitingRoom() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = undefined;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = undefined;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }

    this.winner = undefined;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.maze = PhysicsEngine.generateMaze(9, 7, 100);
    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.status = 'waiting';

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
      player.activeBulletType = undefined;
      player.specialAmmo = 0;
      player.shieldTimer = undefined;
      player.speedTimer = undefined;
      player.rapidFireTimer = undefined;
      player.activePowerup = undefined;
      player.powerupTimer = undefined;
      player.spawnInvincibleTimer = undefined;
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
    }

    this.io.to(this.config.id).emit('matchReturnedToLobby', { maze: this.maze });
    this.broadcastState();
  }

  private update(dt: number) {
    const now = Date.now();

    // If room is NOT 'playing' (e.g. 'waiting', 'preparing', 'round_paused', 'finished', 'gameover'), skip physics & DO NOT deduct time
    if (this.status !== 'playing') {
      this.broadcastState();
      return;
    }

    // Match timer countdown: Strictly reduce remaining seconds while status === 'playing'
    this.timeAccumulator += dt;
    if (this.timeAccumulator >= 1.0) {
      const secondsToDeduct = Math.floor(this.timeAccumulator);
      this.timeAccumulator -= secondsToDeduct;
      this.matchTimeRemaining = Math.max(0, this.matchTimeRemaining - secondsToDeduct);

      if (this.config.mode !== 'teambattle' && this.matchTimeRemaining <= 10 && this.matchTimeRemaining > 0 && this.lastSecondBroadcast !== this.matchTimeRemaining) {
        this.lastSecondBroadcast = this.matchTimeRemaining;
        this.io.to(this.config.id).emit('finalCountdown10s', { remaining: this.matchTimeRemaining });
      }

      if (this.matchTimeRemaining <= 0) {
        this.endMatch('time_up');
        return;
      }
    }

    // 1. Process Players Movement (Humans & AI Bots)
    for (const player of this.players.values()) {
      if (player.hp <= 0) continue;

      if (player.isBot) {
        const botInput = BotAI.updateBot(
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
            // Dead Reckoning: If client stopped transmitting packets for >250ms, safely stop directional movement
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

      // Check powerup / buff timer expirations
      if (player.shieldTimer && now > player.shieldTimer) {
        player.shieldTimer = undefined;
        if (player.activePowerup === 'shield') player.activePowerup = undefined;
      }
      if (player.speedTimer && now > player.speedTimer) {
        player.speedTimer = undefined;
      }
      if (player.rapidFireTimer && now > player.rapidFireTimer) {
        player.rapidFireTimer = undefined;
      }
      if (player.powerupTimer && now > player.powerupTimer) {
        player.activePowerup = undefined;
        player.powerupTimer = undefined;
      }
      if (player.spawnInvincibleTimer && now > player.spawnInvincibleTimer) {
        player.spawnInvincibleTimer = undefined;
      }
    }

    // 2. Process Laser Beams: Dọn dẹp các tia laser đã hết hạn (sát thương được tính duy nhất trong triggerLaserBlastDamage)
    this.laserBeams = this.laserBeams.filter((b) => (b.blastExpiresAt || b.expiresAt || 0) > now);

    // 3. Process Bullet Movement & Bouncing
    const activeBullets: BulletData[] = [];

    for (const bullet of this.bullets) {
      const res = PhysicsEngine.processBulletRicochet(bullet, this.maze.walls, dt);

      if (res.bounced) {
        this.io.to(this.config.id).emit('bulletBounced', {
          x: res.hitPoint?.x,
          y: res.hitPoint?.y,
          normal: res.normal,
        });
      }

      // Destroy if max bounces exceeded
      if (bullet.bounces > bullet.maxBounces) {
        continue;
      }

      // Bullet vs Tank collision
      let destroyed = false;
      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;

        // Bỏ qua va chạm với chủ nhân trong 120ms đầu
        if (bullet.ownerId === player.id && bullet.ignoreOwnerUntil && now < bullet.ignoreOwnerUntil) {
          continue;
        }

        // Nhóm 2 - 🛡️ Khiên Bảo Vệ: Đạn xuyên qua người xe tăng mà không phát nổ
        const targetHasShield = (player.shieldTimer && now < player.shieldTimer) || player.activePowerup === 'shield';
        if (targetHasShield) continue;

        if (PhysicsEngine.checkCircleCollision({ x: bullet.x, y: bullet.y, radius: bullet.radius }, { x: player.x, y: player.y, radius: player.radius })) {
          const shooter = this.players.get(bullet.ownerId);

          // Cấm Friendly Fire trong chế độ Team
          const bulletTeam = bullet.ownerTeam || shooter?.team;
          if (this.config.mode === 'teambattle' && bulletTeam && player.team && bulletTeam === player.team && bullet.ownerId !== player.id) {
            continue;
          }

          // Nhóm 3 - ❤️ mạng phụ: Đỡ 1 phát đạn chí mạng cứu sống tại chỗ, tiêu hủy viên đạn
          if (player.extraLives && player.extraLives > 0) {
            player.extraLives -= 1;
            player.extraLife = player.extraLives > 0;
            destroyed = true;
            this.io.to(this.config.id).emit('bulletBounced', {
              x: bullet.x,
              y: bullet.y,
              normal: { x: 0, y: 0 },
            });
            break;
          }

          // Tank destroyed!
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

    // 4. Check Powerups Expiration on Map (Items on map expire after 18 seconds)
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      const expiresAt = p.expiresAt || (p.createdAt + 18000);
      if (now > expiresAt) {
        this.powerups.splice(i, 1);
      }
    }

    // 5. Periodic Powerup Spawning: Cứ mỗi 10 giây sinh thêm 1 vật phẩm, tối đa 5 vật phẩm trên map (tự biến mất sau 18s)
    if (now - this.lastPowerupSpawn > 10000 && this.powerups.length < 5) {
      this.lastPowerupSpawn = now;
      this.nextPowerupInterval = 10000;
      this.spawnPowerup();
    }

    // 6. Powerup Collection Check (3 Nhóm)
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;
        if (PhysicsEngine.checkCircleCollision({ x: p.x, y: p.y, radius: 16 }, { x: player.x, y: player.y, radius: player.radius })) {
          let title = '';
          let color = '#38bdf8';

          switch (p.type) {
            // Nhóm 1 - ĐẠN (Cấp 5 viên đạn, ghi đè khi nhặt loại mới, VIẾT HOA TOÀN BỘ)
            case 'fastBullet':
              player.activeBulletType = 'fastBullet';
              player.specialAmmo = 5;
              player.activePowerup = 'fastBullet';
              title = '🔥 ĐẠN SIÊU TỐC (5)';
              color = '#ef4444';
              break;
            case 'bigBullet':
            case 'piercing':
              player.activeBulletType = 'bigBullet';
              player.specialAmmo = 5;
              player.activePowerup = 'bigBullet';
              title = '💣 ĐẠN CỠ LỚN (5)';
              color = '#a855f7';
              break;
            case 'crazyBounce':
              player.activeBulletType = 'crazyBounce';
              player.specialAmmo = 5;
              player.activePowerup = 'crazyBounce';
              title = '🪃 ĐẠN SIÊU NẢY (5)';
              color = '#10b981';
              break;
            case 'laser':
              player.activeBulletType = 'laser';
              player.specialAmmo = 5;
              player.activePowerup = 'laser';
              title = '⚡ ĐẠN LASER (5)';
              color = '#f87171';
              break;

            // Nhóm 2 - HIỆU ỨNG (Timer 10s, CỘNG DỒN SONG SONG, Viết Hoa Chữ Cái Đầu)
            case 'shield':
              player.shieldTimer = now + 10000;
              player.activePowerup = 'shield';
              player.powerupTimer = now + 10000;
              title = '🛡️ Khiên Bảo Vệ';
              color = '#3b82f6';
              break;
            case 'speed':
              player.speedTimer = now + 10000;
              title = '⚡ Tăng Tốc Độ';
              color = '#facc15';
              break;
            case 'rapidFire':
              player.rapidFireTimer = now + 10000;
              title = '⏱️ Bắn Liên Tục';
              color = '#ec4899';
              break;

            // Nhóm 3 - NỘI TẠI (Tác động 1 lần, viết thường toàn bộ)
            case 'heart':
            case 'extraLife':
              player.extraLives = Math.min(2, (player.extraLives || 0) + 1);
              player.extraLife = true;
              title = '❤️ mạng phụ';
              color = '#f43f5e';
              break;
          }

          this.io.to(this.config.id).emit('powerupCollected', {
            playerId: player.id,
            playerName: player.name,
            type: p.type,
            title,
            color,
            x: p.x,
            y: p.y,
          });

          this.powerups.splice(i, 1);
          break;
        }
      }
    }

    // 7. Danger Zone (Vòng Bo Tròn) damage check in teambattle
    if (this.config.mode === 'teambattle' && this.matchTimeRemaining <= 20 && this.matchTimeRemaining > 0) {
      const centerX = this.maze.width / 2;
      const centerY = this.maze.height / 2;
      const startRadius = Math.hypot(centerX, centerY);
      const t = Math.min(1.0, Math.max(0, (20 - this.matchTimeRemaining) / 20));
      const currentRadius = Math.max(0, startRadius * (1 - t));

      for (const player of this.players.values()) {
        if (player.hp <= 0) continue;
        const dx = player.x - centerX;
        const dy = player.y - centerY;
        if (dx * dx + dy * dy > currentRadius * currentRadius) {
          // Zone kill IMMEDIATELY ignores extraLives!
          this.destroyTank(player);
        }
      }
    }

    // In teambattle mode, check team elimination every frame as a safeguard
    if (this.config.mode === 'teambattle' && this.status === 'playing') {
      this.checkTeamElimination();
    }

    // 8. Broadcast State Update to Client Sockets
    this.broadcastState();
  }

  public broadcastState() {
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
      hasShield: (p.shieldTimer && now < p.shieldTimer) || p.activePowerup === 'shield',
      isInvincible: p.spawnInvincibleTimer ? now < p.spawnInvincibleTimer : false,
      extraLife: !!(p.extraLife || (p.extraLives && p.extraLives > 0)),
      extraLives: p.extraLives || 0,
      activePowerup: p.activePowerup || null,
      currentEmoji: (p as any).currentEmoji && (p as any).emojiExpiresAt > now ? (p as any).currentEmoji : undefined,
      emojiExpiresAt: (p as any).emojiExpiresAt && (p as any).emojiExpiresAt > now ? (p as any).emojiExpiresAt : undefined,
      currentBubble: (p as any).currentBubble && (p as any).bubbleExpiresAt > now ? (p as any).currentBubble : undefined,
      bubbleExpiresAt: (p as any).bubbleExpiresAt && (p as any).bubbleExpiresAt > now ? (p as any).bubbleExpiresAt : undefined,
    }));

    const bulletsList = this.bullets.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      x: Math.round(b.x * 10) / 10,
      y: Math.round(b.y * 10) / 10,
      vx: Math.round(b.vx),
      vy: Math.round(b.vy),
      radius: b.radius,
      color: b.color,
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
      blastExpiresAt: l.blastExpiresAt,
    }));

    const powerupsList = this.powerups.map((p) => ({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      type: p.type,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt || (p.createdAt + 15000),
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
      isStarting: this.status === 'preparing',
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
      isFrozen: this.status !== 'playing',
      freezeRemaining: this.status === 'preparing' ? Math.max(0, Math.ceil((this.startTime - now) / 1000)) : 0,
    };

    this.io.to(this.config.id).emit('gameState', state);
  }

  /**
   * Sinh sẵn đúng 3 vật phẩm khởi đầu thuộc các loại khác nhau, cách xa điểm xuất phát xe tăng >= 100px
   */
  public spawnInitialPowerups() {
    const allTypes: PowerupData['type'][] = ['fastBullet', 'bigBullet', 'crazyBounce', 'laser', 'shield', 'speed', 'rapidFire', 'heart'];
    const count = 3; // Đúng 3 vật phẩm ngẫu nhiên thuộc các loại khác nhau
    const shuffledTypes = [...allTypes].sort(() => 0.5 - Math.random());
    const selectedTypes = shuffledTypes.slice(0, count);

    const now = Date.now();
    const playerPositions = Array.from(this.players.values()).map((p) => ({ x: p.x, y: p.y }));

    for (const type of selectedTypes) {
      let chosenPos: { x: number; y: number } | null = null;
      let attempts = 0;

      while (attempts < 40) {
        attempts++;
        const pos = this.getRandomSpawnPoint();
        
        // Cách xa các điểm spawn của xe tăng tối thiểu 100px
        const farFromPlayers = playerPositions.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 100);
        // Cách xa các vật phẩm đã sinh tối thiểu 90px
        const farFromPowerups = this.powerups.every((p) => Math.hypot(p.x - pos.x, p.y - pos.y) >= 90);

        if (farFromPlayers && farFromPowerups) {
          chosenPos = pos;
          break;
        }
      }

      if (!chosenPos) {
        chosenPos = this.getRandomSpawnPoint();
      }

      const powerup: PowerupData = {
        id: `pw_init_${now}_${Math.random()}`,
        x: chosenPos.x,
        y: chosenPos.y,
        type,
        createdAt: now,
        expiresAt: now + 18000,
      };

      this.powerups.push(powerup);
    }

    this.io.to(this.config.id).emit('syncPowerups', { powerups: this.powerups });
  }

  private spawnPowerup() {
    const allTypes: PowerupData['type'][] = ['fastBullet', 'bigBullet', 'crazyBounce', 'laser', 'shield', 'speed', 'rapidFire', 'heart'];
    
    // Ưu tiên các loại chưa có trên bản đồ
    const existingTypes = new Set(this.powerups.map((p) => p.type));
    const unspawnedTypes = allTypes.filter((t) => !existingTypes.has(t));
    const candidateList = unspawnedTypes.length > 0 ? unspawnedTypes : allTypes;
    const selectedType = candidateList[Math.floor(Math.random() * candidateList.length)];

    const now = Date.now();
    let chosenPos: { x: number; y: number } | null = null;
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

    const powerup: PowerupData = {
      id: `pw_${now}_${Math.random()}`,
      x: chosenPos.x,
      y: chosenPos.y,
      type: selectedType,
      createdAt: now,
      expiresAt: now + 18000,
    };

    this.powerups.push(powerup);
    this.io.to(this.config.id).emit('powerupSpawned', powerup);
    this.io.to(this.config.id).emit('syncPowerups', { powerups: this.powerups });
  }

  public getRandomSpawnPoint(): { x: number; y: number } {
    const col = Math.floor(Math.random() * this.maze.cols);
    const row = Math.floor(Math.random() * this.maze.rows);
    return {
      x: col * this.maze.cellSize + this.maze.cellSize / 2,
      y: row * this.maze.cellSize + this.maze.cellSize / 2,
    };
  }

  public resetMatch() {
    if (this.preparationTimeout) {
      clearTimeout(this.preparationTimeout);
      this.preparationTimeout = undefined;
    }
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = undefined;
    }
    if (this.roundEndingTimeout) {
      clearTimeout(this.roundEndingTimeout);
      this.roundEndingTimeout = undefined;
    }
    if (this.roundObservationTimeout) {
      clearTimeout(this.roundObservationTimeout);
      this.roundObservationTimeout = undefined;
    }
    this.winner = undefined;
    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.matchTimeRemaining = this.config.matchDuration || 180;
    this.timeAccumulator = 0;
    this.lastSecondBroadcast = -1;
    this.lastPowerupSpawn = Date.now();
    this.nextPowerupInterval = 10000;
    this.maze = PhysicsEngine.generateMaze(9, 7, 100);

    this.seriesScore = { red: 0, blue: 0 };
    this.currentRound = 1;
    if (this.config.boMode === 'BO3' || this.config.boMode === '3') {
      this.winsNeeded = 3;
    } else if (this.config.boMode === 'BO5' || this.config.boMode === '5') {
      this.winsNeeded = 5;
    } else {
      this.winsNeeded = 1;
    }

    const now = Date.now();
    const bannerDuration = 2000;
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
      player.activeBulletType = undefined;
      player.specialAmmo = 0;
      player.shieldTimer = undefined;
      player.speedTimer = undefined;
      player.rapidFireTimer = undefined;
      player.activePowerup = undefined;
      player.powerupTimer = undefined;
      player.spawnInvincibleTimer = this.startTime + 2500;
      player.currentInput = undefined;
      player.lastInput = undefined;
      player.score = 0;
      player.kills = 0;
      player.deaths = 0;
    }

    // Sinh sẵn 3 vật phẩm khởi đầu cho trận đấu mới
    this.spawnInitialPowerups();

    // Trạng thái chuẩn bị: Đóng băng đồng hồ, khóa di chuyển & bắn, vẽ banner thông báo
    this.status = 'preparing';

    const matchPayload = {
      maze: this.maze,
      config: this.config,
      timeRemaining: this.matchTimeRemaining,
      startTime: this.startTime,
      freezeUntil: this.freezeUntil,
      bannerDuration: bannerDuration,
      currentRound: this.currentRound,
      status: 'preparing',
      matchState: 'preparing',
      isStarting: true,
    };

    this.io.to(this.config.id).emit('matchReset', matchPayload);
    this.io.to(this.config.id).emit('matchStarted', matchPayload);
    this.broadcastState();

    // Đúng sau 2 giây chuẩn bị: Chuyển sang 'playing', ẩn banner, bắt đầu trừ giây đồng hồ và mở khóa điều khiển
    this.preparationTimeout = setTimeout(() => {
      try {
        if (this.players.size > 0 && this.status === 'preparing') {
          this.status = 'playing';
          this.timeAccumulator = 0;
          this.roundStartTime = Date.now();
          this.io.to(this.config.id).emit('matchPlaying', {
            currentRound: this.currentRound,
            timeRemaining: this.matchTimeRemaining,
            status: 'playing',
            matchState: 'playing',
          });
          this.broadcastState();
        }
      } catch (err) {
        console.error('[Room] Error in preparationTimeout callback (reset match):', err);
      }
    }, bannerDuration);
  }

  public getUniqueColor(team?: string): string {
    if (team === 'red') return TEAM_RED_THEME.body;
    if (team === 'blue') return TEAM_BLUE_THEME.body;

    const usedColors = new Set<string>();
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

  private getRandomColor(): string {
    return this.getUniqueColor();
  }
}
