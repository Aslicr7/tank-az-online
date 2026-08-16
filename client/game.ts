/**
 * Tank AZ Online - Client Main Game Loop
 * Socket.IO integration, offline local loop, rendering, input handling, audio & interpolation.
 */

import { io, Socket } from 'socket.io-client';
import { TankRenderer, PlayerNetworkController, TANK_COLORS } from './player.js';
import { BulletRenderer } from './bullet.js';
import { MapRenderer } from './map.js';
import { EffectsManager } from './effects.js';
import { soundEngine } from './sound.js';
import { UIManager } from './ui.js';
import { InputManager } from './input.js';
import { PhysicsEngine } from '../server/physics.ts';
import { BotAI } from '../server/bot.ts';

export class GameClient {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private socket?: Socket;
  private ui!: UIManager;
  private inputManager!: InputManager;
  private mapRenderer: MapRenderer;
  private effects: EffectsManager;

  // Game state
  private isOnline = false;
  private isOffline = false;
  private roomId?: string;
  private localPlayerId = 'p1_local';
  private playerName = 'Tanker_AZ';
  private playerSticker = '🐥';

  private maze: any = null;
  private players: any[] = [];
  private bullets: any[] = [];
  private powerups: any[] = [];
  private roomConfig: any = null;

  // Offline game variables
  private offlineBullets: any[] = [];
  private offlinePowerups: any[] = [];
  private lastOfflinePowerup = 0;
  private nextOfflinePowerupInterval = 5000;
  private offlineBulletCounter = 0;
  private laserBeams: {
    id?: string;
    shooterId?: string;
    shooterColor?: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    createdAt?: number;
    stage: 'aiming' | 'blasted';
    aimStartTime?: number;
    aimDuration?: number;
    blastStartedAt?: number;
    blastDuration?: number;
    expiresAt?: number;
    hasDealtDamage?: boolean;
  }[] = [];

  // Performance metrics
  private lastFrameTime = performance.now();
  private fps = 60;
  private frameCount = 0;
  private lastFpsUpdate = performance.now();
  private ping = 0;
  private endGameTimer: any = null;
  private roundEndingInterval: any = null;
  private timeRemaining = 180;
  private timeAccumulator = 0;
  private latestHostId?: string;
  private latestStatus = 'waiting';
  private matchState = 'waiting';
  private offlineStartTimeout: any = null;
  private startTime = 0;
  private freezeUntil = 0;
  private roundAnnouncement: { type?: 'preparation' | 'round_end'; mainText: string; subText?: string; color: string; strokeColor?: string; expiresAt: number } | null = null;
  private seriesWinCelebration: any = null;

  constructor() {
    this.mapRenderer = new MapRenderer();
    this.effects = new EffectsManager();
  }

  public init() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.initSocket();

    this.inputManager = new InputManager({
      onGamepadStatusChanged: (connected, id) => {
        if (connected) {
          this.effects.addFloatingText('🎮 TAY CẦM ĐÃ KẾT NỐI!', this.canvas.width / 2, 80, '#38bdf8', 20);
        }
      },
    });
    this.inputManager.init();

    this.ui = new UIManager({
      onLogin: (name: string, sticker: string) => this.handleLogin(name, sticker),
      onCreateRoom: (data: any) => this.createRoom(data),
      onRefreshRooms: () => this.refreshRooms(),
      onJoinRoomId: (id: string, sticker: string, password?: string) => this.joinRoom(id, sticker, password),
      onStartMatch: () => this.startMatch(),
      onStartOffline: () => this.startOfflineGame(),
      onLeaveGame: () => this.leaveGame(),
      onRestartMatch: () => this.restartMatch(),
      onResizeRequested: () => this.handleCanvasResizeImmediate(),
      onVolumeChange: (val: number) => {
        soundEngine.masterVolume = val;
      },
      onSwitchTeam: (team: 'red' | 'blue') => {
        this.socket?.emit('switchTeam', { team });
      },
      onAddBotToTeam: (team: string, difficulty?: string) => {
        const isDm = team === 'deathmatch' || team === 'none';
        const diff = difficulty || localStorage.getItem('bot_difficulty') || 'smart';
        this.socket?.emit('addBotToTeam', {
          team: isDm ? 'none' : team,
          mode: isDm ? 'deathmatch' : undefined,
          difficulty: diff,
          botDifficulty: diff,
        });
      },
      onRemoveBotFromTeam: (team: string) => {
        const isDm = team === 'deathmatch' || team === 'none';
        this.socket?.emit('removeBotFromTeam', { team: isDm ? 'none' : team, mode: isDm ? 'deathmatch' : undefined });
      },
      onSendChat: (msg: string) => {
        if (this.isOnline) {
          this.socket?.emit('sendChat', { message: msg });
        } else if (this.isOffline) {
          // Gửi tin nhắn văn bản chỉ hiển thị ở Chat Box UI, không hiển thị trên đầu xe tăng
          this.ui.appendChatMessage({
            senderName: this.playerName,
            senderSticker: this.playerSticker,
            senderColor: '#38bdf8',
            message: msg,
          }, true);
        }
      },
      onSendEmote: (emote: string) => {
        const now = Date.now();
        // Optimistic UI: Gán ngay cho xe tăng hiện tại và EffectsManager để hiển thị tức thì không có độ trễ
        const myId = this.isOnline ? this.socket?.id : 'p1_local';
        if (myId) {
          this.effects.triggerEmoji(myId, emote, 2500);
        }
        const myPlayer = myId ? (this.players.find((pl) => pl.id === myId) || null) : null;
        if (myPlayer) {
          myPlayer.currentEmoji = emote;
          myPlayer.emojiExpiresAt = now + 2500;
          myPlayer.emojiStartedAt = now;
        }

        if (this.isOnline) {
          this.socket?.emit('sendEmoji', { emoji: emote });
        } else if (this.isOffline) {
          this.ui.appendChatMessage({
            senderName: this.playerName,
            senderSticker: this.playerSticker,
            senderColor: '#38bdf8',
            message: emote,
            emoji: emote,
            emote: emote,
          }, true);
        }
      },
      onToggleTouchControls: (enabled: boolean) => {
        this.inputManager.setTouchUIEnabled(enabled);
      },
      getTouchUIEnabled: () => {
        return this.inputManager.getTouchUIEnabled();
      },
      onSetInGame: (inGame: boolean) => {
        this.inputManager.setInGame(inGame);
      },
    });

    // Start 60 FPS Render Loop
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = 900;
    this.canvas.height = 700;
  }

  private handleCanvasResizeImmediate() {
    this.resizeCanvas();
    window.dispatchEvent(new Event('resize'));
    setTimeout(() => {
      this.resizeCanvas();
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  private initSocket() {
    this.socket = io();
    (window as any).socket = this.socket;

    this.socket.on('connect', () => {
      console.log('Socket Connected to Server!');
      this.startPingCheck();
    });

    this.socket.on('gameState', (state) => {
      if (!this.isOnline) return;

      if (Array.isArray(state.players)) {
        const existingMap = new Map<string, any>();
        for (const p of this.players) {
          existingMap.set(p.id, p);
        }

        const now = Date.now();
        const updatedList: any[] = [];
        for (const sp of state.players) {
          const existing = existingMap.get(sp.id);
          const activeEmojiEntry = this.effects.getActiveEmoji(sp.id);
          if (existing) {
            const prevEmoji = existing.currentEmoji;
            const prevExpires = existing.emojiExpiresAt;
            const prevStarted = existing.emojiStartedAt;

            Object.assign(existing, sp);

            // Bảo toàn Emoji trạng thái cục bộ nếu còn hạn hoặc có trong EffectsManager
            if (prevExpires && now < prevExpires && prevEmoji) {
              existing.currentEmoji = prevEmoji;
              existing.emojiExpiresAt = prevExpires;
              existing.emojiStartedAt = prevStarted;
            } else if (activeEmojiEntry) {
              existing.currentEmoji = activeEmojiEntry.emoji;
              existing.emojiExpiresAt = activeEmojiEntry.expiresAt;
              existing.emojiStartedAt = activeEmojiEntry.startedAt;
            }

            existing.activePowerup = sp.activePowerup || undefined;
            existing.activeBulletType = sp.activeBulletType || undefined;
            existing.specialAmmo = sp.specialAmmo !== undefined ? sp.specialAmmo : 0;
            existing.shieldTimer = sp.shieldTimer || 0;
            existing.speedTimer = sp.speedTimer || 0;
            existing.rapidFireTimer = sp.rapidFireTimer || 0;
            existing.hasShield = !!sp.hasShield || sp.activePowerup === 'shield' || (sp.shieldTimer && now < sp.shieldTimer);
            existing.extraLife = !!(sp.extraLife || (sp.extraLives && sp.extraLives > 0));
            existing.extraLives = sp.extraLives || 0;
            existing.isInvincible = !!sp.isInvincible;

            existing.targetX = sp.x;
            existing.targetY = sp.y;
            existing.targetBodyAngle = sp.bodyAngle !== undefined ? sp.bodyAngle : sp.angle;
            existing.targetTurretAngle = sp.turretAngle !== undefined ? sp.turretAngle : sp.bodyAngle;
            existing.targetAngle = existing.targetBodyAngle;

            if (existing.x === undefined) existing.x = sp.x;
            if (existing.y === undefined) existing.y = sp.y;
            if (existing.bodyAngle === undefined) existing.bodyAngle = existing.targetBodyAngle;
            if (existing.turretAngle === undefined) existing.turretAngle = existing.targetTurretAngle;
            if (existing.angle === undefined) existing.angle = existing.bodyAngle;

            const dx = existing.targetX - existing.x;
            const dy = existing.targetY - existing.y;
            if (dx * dx + dy * dy > 22500) {
              existing.x = existing.targetX;
              existing.y = existing.targetY;
              existing.bodyAngle = existing.targetBodyAngle;
              existing.turretAngle = existing.targetTurretAngle;
              existing.angle = existing.bodyAngle;
            }

            updatedList.push(existing);
          } else {
            const targetBodyAngle = sp.bodyAngle !== undefined ? sp.bodyAngle : (sp.angle || 0);
            const targetTurretAngle = sp.turretAngle !== undefined ? sp.turretAngle : targetBodyAngle;
            const newPlayer = {
              ...sp,
              currentEmoji: activeEmojiEntry?.emoji,
              emojiExpiresAt: activeEmojiEntry?.expiresAt,
              emojiStartedAt: activeEmojiEntry?.startedAt,
              activePowerup: sp.activePowerup || undefined,
              activeBulletType: sp.activeBulletType || undefined,
              specialAmmo: sp.specialAmmo !== undefined ? sp.specialAmmo : 0,
              shieldTimer: sp.shieldTimer || 0,
              speedTimer: sp.speedTimer || 0,
              rapidFireTimer: sp.rapidFireTimer || 0,
              hasShield: !!sp.hasShield || sp.activePowerup === 'shield' || (sp.shieldTimer && now < sp.shieldTimer),
              extraLife: !!(sp.extraLife || (sp.extraLives && sp.extraLives > 0)),
              extraLives: sp.extraLives || 0,
              x: sp.x,
              y: sp.y,
              bodyAngle: targetBodyAngle,
              turretAngle: targetTurretAngle,
              angle: targetBodyAngle,
              targetX: sp.x,
              targetY: sp.y,
              targetBodyAngle: targetBodyAngle,
              targetTurretAngle: targetTurretAngle,
              targetAngle: targetBodyAngle,
            };
            updatedList.push(newPlayer);
          }
        }
        this.players = updatedList;
      }

      this.bullets = state.bullets;
      this.powerups = state.powerups;

      // Sync any active laser beams from server
      if (Array.isArray(state.laserBeams)) {
        const now = Date.now();
        for (const beam of state.laserBeams) {
          const existing = this.laserBeams.find((b) => b.id === beam.id);
          if (existing) {
            if (beam.hasDealtDamage && existing.stage !== 'blasted') {
              existing.stage = 'blasted';
              existing.blastStartedAt = now;
              existing.blastDuration = 80;
              existing.expiresAt = now + 80;
              existing.hasDealtDamage = true;
            }
          } else if ((beam.expiresAt || 0) > now) {
            const isBlasted = !!beam.hasDealtDamage;
            this.laserBeams.push({
              id: beam.id,
              shooterId: beam.shooterId,
              x1: beam.x1,
              y1: beam.y1,
              x2: beam.x2,
              y2: beam.y2,
              color: beam.color || '#f87171',
              createdAt: beam.createdAt || now,
              stage: isBlasted ? 'blasted' : 'aiming',
              aimStartTime: beam.createdAt || now,
              aimDuration: 40,
              blastStartedAt: isBlasted ? now : undefined,
              blastDuration: 80,
              expiresAt: beam.expiresAt || (now + 80),
              hasDealtDamage: isBlasted,
            });
          }
        }
      }

      const isHost = !!(this.socket?.id && state.hostId === this.socket.id);
      this.latestHostId = state.hostId;
      this.latestStatus = state.status;
      this.matchState = state.matchState || state.status;
      if (this.latestStatus === 'playing' && this.roundAnnouncement?.type === 'preparation') {
        this.roundAnnouncement = null;
      }
      this.ui.setHostStatus(isHost);

      const myPlayer = this.players.find((p) => p.id === this.socket?.id);
      this.ui.updateWaitingRoomState(
        state.status,
        isHost,
        this.players.length,
        state.maxPlayers || this.roomConfig?.maxPlayers || 4,
        state.mode || this.roomConfig?.mode,
        myPlayer?.team
      );

      // Auto hide MVP modal only after endGameTimer is done
      if (state.status === 'waiting') {
        const mvpModal = document.getElementById('modal-mvp');
        if (mvpModal && !mvpModal.classList.contains('hidden') && !this.endGameTimer) {
          this.ui.hideModal('modal-mvp');
        }
      }

      this.ui.updateHUD(this.players, this.socket?.id || '', state.hostId, this.roomConfig);
      this.ui.updateSeriesScore(state.boMode, state.seriesScore, state.winsNeeded, state.currentRound, this.roomConfig?.mode, this.isOffline);
      if (typeof state.startTime === 'number') {
        this.startTime = state.startTime;
        this.freezeUntil = state.startTime;
      } else if (typeof state.freezeUntil === 'number') {
        this.startTime = state.freezeUntil;
        this.freezeUntil = state.freezeUntil;
      }
      if (typeof state.timeRemaining === 'number') {
        this.timeRemaining = state.timeRemaining;
        this.ui.updateMatchTimer(state.timeRemaining);
      }
    });

    const handleRoomUpdated = (data: any) => {
      if (!this.isOnline) return;
      const roomData = data.room || data;
      if (roomData.players) {
        const rawPlayers = Array.isArray(roomData.players) ? roomData.players : Object.values(roomData.players);
        const existingMap = new Map<string, any>();
        for (const p of this.players) {
          existingMap.set(p.id, p);
        }

        const now = Date.now();
        const updatedList: any[] = [];
        for (const sp of rawPlayers) {
          const existing = existingMap.get(sp.id);
          const activeEmojiEntry = this.effects.getActiveEmoji(sp.id);
          if (existing) {
            const prevEmoji = existing.currentEmoji;
            const prevExpires = existing.emojiExpiresAt;
            const prevStarted = existing.emojiStartedAt;

            Object.assign(existing, sp);

            if (prevExpires && now < prevExpires && prevEmoji) {
              existing.currentEmoji = prevEmoji;
              existing.emojiExpiresAt = prevExpires;
              existing.emojiStartedAt = prevStarted;
            } else if (activeEmojiEntry) {
              existing.currentEmoji = activeEmojiEntry.emoji;
              existing.emojiExpiresAt = activeEmojiEntry.expiresAt;
              existing.emojiStartedAt = activeEmojiEntry.startedAt;
            }

            existing.activePowerup = sp.activePowerup || undefined;
            existing.hasShield = !!sp.hasShield || sp.activePowerup === 'shield';
            existing.isInvincible = !!sp.isInvincible;
            if (sp.x !== undefined) {
              existing.targetX = sp.x;
              existing.targetY = sp.y;
              existing.targetBodyAngle = sp.bodyAngle !== undefined ? sp.bodyAngle : sp.angle;
              existing.targetTurretAngle = sp.turretAngle !== undefined ? sp.turretAngle : sp.bodyAngle;
              existing.targetAngle = existing.targetBodyAngle;
            }
            updatedList.push(existing);
          } else {
            const targetBodyAngle = sp.bodyAngle !== undefined ? sp.bodyAngle : (sp.angle || 0);
            const targetTurretAngle = sp.turretAngle !== undefined ? sp.turretAngle : targetBodyAngle;
            const newP = {
              ...sp,
              currentEmoji: activeEmojiEntry?.emoji,
              emojiExpiresAt: activeEmojiEntry?.expiresAt,
              emojiStartedAt: activeEmojiEntry?.startedAt,
              x: sp.x ?? 0,
              y: sp.y ?? 0,
              bodyAngle: targetBodyAngle,
              turretAngle: targetTurretAngle,
              angle: targetBodyAngle,
              targetX: sp.x ?? 0,
              targetY: sp.y ?? 0,
              targetBodyAngle: targetBodyAngle,
              targetTurretAngle: targetTurretAngle,
              targetAngle: targetBodyAngle,
            };
            updatedList.push(newP);
          }
        }
        this.players = updatedList;
      }
      const isHost = !!(this.socket?.id && (roomData.hostId === this.socket.id || roomData.ownerId === this.socket.id));
      this.ui.setHostStatus(isHost);

      const myPlayer = this.players.find((p) => p.id === this.socket?.id);
      this.ui.updateWaitingRoomState(
        roomData.status || 'waiting',
        isHost,
        this.players.length,
        roomData.maxPlayers || roomData.config?.maxPlayers || this.roomConfig?.maxPlayers || 10,
        roomData.mode || roomData.config?.mode || this.roomConfig?.mode,
        myPlayer?.team
      );
      this.ui.updateHUD(this.players, this.socket?.id || '', roomData.hostId || roomData.ownerId, this.roomConfig);
    };

    this.socket.on('room_updated', handleRoomUpdated);

    this.socket.on('lobbyChat', (data: any) => {
      this.ui.appendChatMessage(data, false);
    });

    this.socket.on('roomChat', (data: any) => {
      this.ui.appendChatMessage(data, true);
    });


    const hideRoundEndingBanner = () => {
      this.ui.hideRoundEndModal();
      const banner = document.getElementById('hud-round-ending-banner');
      if (banner) banner.classList.add('hidden');
      if (this.roundEndingInterval) {
        clearInterval(this.roundEndingInterval);
        this.roundEndingInterval = null;
      }
    };

    this.socket.on('roundEnding', (data: any) => {
      try {
        hideRoundEndingBanner();
        soundEngine.playVictory?.();

        let winnerText = '🤝 HIỆP NÀY HÒA!';
        let textColor = '#facc15';
        let strokeColor = '#facc15';
        if (data?.roundWinnerTeam === 'red') {
          winnerText = '🔴 ĐỘI ĐỎ GIÀNH CHIẾN THẮNG HIỆP NÀY!';
          textColor = '#f87171';
          strokeColor = '#ef4444';
        } else if (data?.roundWinnerTeam === 'blue') {
          winnerText = '🔵 ĐỘI XANH GIÀNH CHIẾN THẮNG HIỆP NÀY!';
          textColor = '#60a5fa';
          strokeColor = '#3b82f6';
        } else if (data?.roundMvpName) {
          winnerText = `👑 ${String(data.roundMvpName).toUpperCase()} THẮNG HIỆP NÀY!`;
          textColor = '#facc15';
          strokeColor = '#facc15';
        }

        // Hiển thị trực tiếp trên Canvas trong 3 giây đóng băng hiện trường (CHỈ hiển thị tên đội chiến thắng, không kèm tỉ số)
        this.latestStatus = 'round_paused';
        this.matchState = 'round_paused';
        this.roundAnnouncement = {
          type: 'round_end',
          mainText: winnerText,
          subText: '',
          color: textColor,
          strokeColor: strokeColor,
          expiresAt: Date.now() + 3200,
        };
      } catch (err) {
        console.error('[Game] Error handling roundEnding:', err);
      }
    });

    this.socket.on('matchPlaying', (data: any) => {
      this.latestStatus = 'playing';
      this.matchState = 'playing';
      if (this.roundAnnouncement?.type === 'preparation') {
        this.roundAnnouncement = null;
      }
      if (typeof data?.timeRemaining === 'number') {
        this.timeRemaining = data.timeRemaining;
        this.ui.updateMatchTimer(this.timeRemaining);
      }
    });

    this.socket.on('roundEnded', (data: any) => {
      soundEngine.playPowerup?.();
    });

    this.socket.on('nextRoundStarted', (data: any) => {
      hideRoundEndingBanner();
      soundEngine.playMatchStart?.();
      if (data?.maze) this.maze = data.maze;
      this.effects = new EffectsManager();

      const now = Date.now();
      const bannerDuration = 2000;
      const targetStartTime = typeof data?.startTime === 'number' ? data.startTime : (typeof data?.freezeUntil === 'number' ? data.freezeUntil : (now + bannerDuration));
      this.startTime = targetStartTime;
      this.freezeUntil = targetStartTime;
      this.latestStatus = 'preparing';
      this.matchState = 'preparing';

      if (typeof data?.timeRemaining === 'number') {
        this.timeRemaining = data.timeRemaining;
        this.ui.updateMatchTimer(this.timeRemaining);
      }

      const isTeam = (this.roomConfig?.mode || data?.config?.mode) === 'teambattle';
      const roundNum = data?.currentRound || 1;
      const mainText = isTeam ? `BẮT ĐẦU HIỆP ${roundNum}!` : 'TRẬN ĐẤU BẮT ĐẦU!';

      this.roundAnnouncement = {
        type: 'preparation',
        mainText: mainText,
        subText: '',
        color: '#f472b6',
        strokeColor: '#db2777',
        expiresAt: targetStartTime,
      };
    });

    const handleMatchStarted = (data: any) => {
      hideRoundEndingBanner();
      this.seriesWinCelebration = null;
      soundEngine.playMatchStart?.();
      if (this.endGameTimer) {
        clearTimeout(this.endGameTimer);
        this.endGameTimer = null;
      }
      this.ui.hideModal('modal-mvp');
      if (data?.maze) this.maze = data.maze;
      if (data?.config) this.roomConfig = data.config;
      this.effects = new EffectsManager();

      const now = Date.now();
      const bannerDuration = 2000;
      const targetStartTime = typeof data?.startTime === 'number' ? data.startTime : (typeof data?.freezeUntil === 'number' ? data.freezeUntil : (now + bannerDuration));
      this.startTime = targetStartTime;
      this.freezeUntil = targetStartTime;
      this.latestStatus = 'preparing';
      this.matchState = 'preparing';

      if (typeof data?.timeRemaining === 'number') {
        this.timeRemaining = data.timeRemaining;
        this.ui.updateMatchTimer(this.timeRemaining);
      }

      const isTeam = (data?.config?.mode || this.roomConfig?.mode) === 'teambattle';
      const roundNum = data?.currentRound || 1;
      const mainText = isTeam ? `BẮT ĐẦU HIỆP ${roundNum}!` : 'TRẬN ĐẤU BẮT ĐẦU!';

      // Thông báo Bắt Đầu Trận Đấu màu HỒNG pastel (#f472b6 viền #db2777)
      this.roundAnnouncement = {
        type: 'preparation',
        mainText: mainText,
        subText: '',
        color: '#f472b6',
        strokeColor: '#db2777',
        expiresAt: targetStartTime,
      };
    };

    this.socket.on('matchStarted', handleMatchStarted);
    this.socket.on('matchReset', handleMatchStarted);

    this.socket.on('matchReturnedToLobby', (data: any) => {
      hideRoundEndingBanner();
      this.roundAnnouncement = null;
      this.seriesWinCelebration = null;
      if (this.endGameTimer) {
        clearTimeout(this.endGameTimer);
        this.endGameTimer = null;
      }
      this.ui.hideModal('modal-mvp');
      const canvasEl = document.getElementById('game-canvas');
      if (canvasEl) canvasEl.classList.remove('screen-shake-subtle');
      if (data?.maze) this.maze = data.maze;
      this.effects = new EffectsManager();
      this.latestStatus = 'waiting';

      const myPlayer = this.players.find((p) => p.id === this.socket?.id);
      const isHost = !!(this.socket?.id && this.latestHostId === this.socket.id);
      this.ui.updateWaitingRoomState(
        'waiting',
        isHost,
        this.players.length,
        this.roomConfig?.maxPlayers || 4,
        this.roomConfig?.mode,
        myPlayer?.team
      );
    });

    const handleGameEnd = (mvpData: any) => {
      try {
        hideRoundEndingBanner();
        this.roundAnnouncement = null;
        this.seriesWinCelebration = mvpData;
        soundEngine.playVictory?.();

        this.ui.showMVPModal(mvpData);

        if (this.endGameTimer) {
          clearTimeout(this.endGameTimer);
          this.endGameTimer = null;
        }

        // Tự động giữ Bảng Vinh Danh trong 6 giây rồi quay về phòng chờ (Lobby)
        this.endGameTimer = setTimeout(() => {
          try {
            this.seriesWinCelebration = null;
            this.roundAnnouncement = null;
            this.ui.hideModal('modal-mvp');
            const canvasEl = document.getElementById('game-canvas');
            if (canvasEl) canvasEl.classList.remove('screen-shake-subtle');
            this.effects = new EffectsManager();
            this.endGameTimer = null;

            const myPlayer = this.players.find((p) => p.id === this.socket?.id);
            const isHost = !!(this.socket?.id && this.latestHostId === this.socket.id);
            this.ui.updateWaitingRoomState(
              this.latestStatus || 'waiting',
              isHost,
              this.players.length,
              this.roomConfig?.maxPlayers || 4,
              this.roomConfig?.mode,
              myPlayer?.team
            );
          } catch (err) {
            console.error('[Game] Error in endGameTimer callback:', err);
          }
        }, 6000);
      } catch (err) {
        console.error('[Game] Error in handleGameEnd:', err);
      }
    };

    this.socket.on('match_ended', handleGameEnd);
    this.socket.on('team_series_ended', handleGameEnd);
    this.socket.on('matchEnded', handleGameEnd);
    this.socket.on('gameEnded', handleGameEnd);

    this.socket.on('matchForfeited', (data: any) => {
      this.effects.addFloatingText(
        data?.message || 'ĐỐI THỦ ĐÃ THOÁT TRẬN! ĐỘI BẠN GIÀNH CHIẾN THẮNG CHUNG CUỘC!',
        this.canvas.width / 2,
        this.canvas.height / 2,
        '#f87171',
        24
      );
    });

    this.socket.on('loginError', (errMsg: string) => {
      this.ui.showLoginError(errMsg || 'Tên này đã có người sử dụng, vui lòng chọn tên khác!');
      this.ui.showScreen('screen-login');
    });

    this.socket.on('loginSuccess', (data: { name: string; sticker?: string }) => {
      this.playerName = data.name;
      if (data.sticker) this.playerSticker = data.sticker;
      this.ui.clearLoginError();
      this.ui.setPlayerName(data.name, data.sticker || this.playerSticker);
      this.ui.showScreen('screen-menu');
    });

    this.socket.on('roomListUpdated', (rooms: any[]) => {
      this.ui.renderRoomList(rooms);
    });

    this.socket.on('roomError', (errMsg: string) => {
      alert(errMsg || 'Đã xảy ra lỗi!');
      const gameScreen = document.getElementById('screen-game');
      if (!gameScreen || gameScreen.classList.contains('hidden')) {
        this.ui.showModal('modal-create-room');
      }
    });

    this.socket.on('errorMessage', (errMsg: string) => {
      alert(errMsg || 'Đã xảy ra lỗi!');
    });

    this.socket.on('roomDisbanded', (data: any) => {
      alert(data?.message || 'Chủ phòng đã giải tán phòng!');
      this.leaveGame();
      this.refreshRooms();
    });

    this.socket.on('bulletFired', (data) => {
      soundEngine.playShoot();
      this.effects.triggerMuzzleFlash(data.x, data.y, data.angle);
    });

    const handleLaserAim = (data: any) => {
      soundEngine.playShoot?.();
      const now = Date.now();
      const aimDur = data.aimDuration || 120;
      const blastDur = data.blastDuration || 160;

      const existingIdx = this.laserBeams.findIndex((b) => b.id === data.id);
      const beamData: typeof this.laserBeams[0] = {
        id: data.id,
        shooterId: data.shooterId,
        shooterColor: data.shooterColor,
        x1: data.x1,
        y1: data.y1,
        x2: data.x2,
        y2: data.y2,
        color: data.color || 'rgba(239, 68, 68, 0.85)',
        createdAt: now,
        stage: 'aiming',
        aimStartTime: now,
        aimDuration: aimDur,
        blastDuration: blastDur,
        expiresAt: now + aimDur + blastDur + 100,
        hasDealtDamage: false,
      };

      if (existingIdx >= 0) {
        if (this.laserBeams[existingIdx].stage !== 'blasted') {
          this.laserBeams[existingIdx] = beamData;
        }
      } else {
        this.laserBeams.push(beamData);
      }
    };

    this.socket.on('laserAiming', handleLaserAim);
    this.socket.on('laserFired', handleLaserAim);

    this.socket.on('laserBlasted', (data) => {
      soundEngine.playExplosion?.();
      this.effects.triggerLaserFlash(data.x1, data.y1, Math.atan2(data.y2 - data.y1, data.x2 - data.x1));
      const now = Date.now();
      const existing = this.laserBeams.find((b) => b.id === data.id);
      if (existing) {
        existing.stage = 'blasted';
        existing.blastStartedAt = now;
        existing.blastDuration = 160;
        existing.expiresAt = now + 160;
        existing.x1 = data.x1;
        existing.y1 = data.y1;
        existing.x2 = data.x2;
        existing.y2 = data.y2;
        existing.hasDealtDamage = true;
      } else {
        this.laserBeams.push({
          id: data.id,
          shooterId: data.shooterId,
          x1: data.x1,
          y1: data.y1,
          x2: data.x2,
          y2: data.y2,
          color: '#ef4444',
          createdAt: now,
          stage: 'blasted',
          blastStartedAt: now,
          blastDuration: 160,
          expiresAt: now + 160,
          hasDealtDamage: true,
        });
      }
    });

    this.socket.on('syncPowerups', (data) => {
      if (Array.isArray(data?.powerups)) {
        this.powerups = data.powerups;
      }
    });

    this.socket.on('wallDestroyed', (data) => {
      soundEngine.playExplosion?.();
      this.effects.triggerExplosion(data.x, data.y, '#ea580c');
    });

    this.socket.on('bulletBounced', (data) => {
      soundEngine.playBounce();
      this.effects.triggerSparkBounce(data.x, data.y, data.normal);
    });

    this.socket.on('tankExploded', (data) => {
      soundEngine.playExplosion();
      this.effects.triggerExplosion(data.x, data.y, data.color);
    });

    this.socket.on('powerupCollected', (data) => {
      soundEngine.playPowerup();
      let displayName = data.title;
      let displayColor = data.color || '#38bdf8';
      if (!displayName) {
        switch (data.type) {
          case 'fastBullet': displayName = '🔥 ĐẠN SIÊU TỐC (5)'; displayColor = '#ef4444'; break;
          case 'bigBullet':
          case 'piercing': displayName = '💣 ĐẠN CỠ LỚN (5)'; displayColor = '#a855f7'; break;
          case 'crazyBounce': displayName = '🪃 ĐẠN SIÊU NẢY (5)'; displayColor = '#10b981'; break;
          case 'laser': displayName = '⚡ ĐẠN LASER (5)'; displayColor = '#f87171'; break;
          case 'shield': displayName = '🛡️ Khiên Bảo Vệ'; displayColor = '#3b82f6'; break;
          case 'speed': displayName = '⚡ Tăng Tốc Độ'; displayColor = '#facc15'; break;
          case 'rapidFire': displayName = '⏱️ Bắn Liên Tục'; displayColor = '#ec4899'; break;
          case 'heart':
          case 'extraLife': displayName = '❤️ mạng phụ'; displayColor = '#f43f5e'; break;
          default: displayName = `+${data.type}`; break;
        }
      }
      this.effects.addFloatingText(displayName, data.x, data.y, displayColor, 18);
    });

    this.socket.on('matchReset', (data) => {
      this.ui.hideModal('modal-mvp');
      this.maze = data.maze;
      this.effects = new EffectsManager();
    });

    this.socket.on('finalCountdown10s', (data: { remaining: number }) => {
      // Ẩn / bỏ hiển thị đồng hồ đếm ngược 10s cuối trên bản đồ ở chế độ Đội Đỏ vs Đội Xanh (Team Battle)
      if (this.roomConfig?.mode === 'teambattle') return;

      if (data.remaining === 10) {
        soundEngine.playCountdownBeep?.(true);
        this.effects.addFloatingText('⏰ 10 GIÂY CUỐI CÙNG!', this.canvas.width / 2, this.canvas.height / 2 - 30, '#ef4444', 32);
      } else if (data.remaining <= 9 && data.remaining >= 1) {
        soundEngine.playCountdownBeep?.(data.remaining === 1);
        this.effects.addFloatingText(`⏰ ${data.remaining}`, this.canvas.width / 2, this.canvas.height / 2 + 10, '#f87171', 28);
      }
    });

    // Dọn dẹp listener cũ trước khi đăng ký để tránh trùng lặp tin nhắn và sự kiện
    this.socket.off('playerEmoji');
    this.socket.off('playerEmote');
    this.socket.off('emoji');
    this.socket.off('emote');
    this.socket.off('chatMessage');
    this.socket.off('roomChat');
    this.socket.off('lobbyChat');

    // Xử lý sự kiện Emoji từ Server
    const handlePlayerEmojiEvent = (data: any) => {
      if (!data) return;
      const pid = data.playerId || data.senderId || data.id;
      const emoji = data.emoji || data.emote;
      if (!emoji || !pid) return;

      const now = Date.now();
      const expires = data.expiresAt || (now + 2500);

      // Luôn cập nhật EffectsManager độc lập
      this.effects.triggerEmoji(pid, emoji, Math.max(1000, expires - now));

      // Nếu là chính mình (đã gán trước qua Optimistic UI) thì bỏ qua để không reset thời gian gây giật/nháy hình
      if (this.socket && this.socket.id && pid === this.socket.id) {
        return;
      }

      const target = this.players.find((p) => p.id === pid);
      if (target) {
        target.currentEmoji = emoji;
        target.emojiExpiresAt = expires;
        target.emojiStartedAt = now;
      }
    };

    this.socket.on('playerEmoji', handlePlayerEmojiEvent);

    // Xử lý tin nhắn văn bản trong phòng (Chỉ append vào khung chat UI một lần duy nhất)
    const handleChatMessageEvent = (data: any) => {
      if (!data) return;
      if (this.ui) {
        this.ui.appendChatMessage(data, true);
      }
    };

    this.socket.on('chatMessage', handleChatMessageEvent);

    // Xử lý tin nhắn sảnh chờ (Chỉ append vào khung chat lobby một lần duy nhất)
    this.socket.on('lobbyChat', (data: any) => {
      if (!data) return;
      if (this.ui) {
        this.ui.appendChatMessage(data, false);
      }
    });
  }

  private startPingCheck() {
    setInterval(() => {
      if (this.socket && this.socket.connected) {
        const start = Date.now();
        this.socket.emit('ping', () => {
          this.ping = Date.now() - start;
        });
      }
    }, 2000);
  }

  private handleLogin(requestedName: string, sticker: string) {
    const cleanName = (requestedName || '').trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      this.ui.showLoginError('Vui lòng nhập tên người chơi!');
      return;
    }
    this.playerName = cleanName;
    this.playerSticker = sticker;

    try {
      localStorage.setItem('tank_username', cleanName);
      localStorage.setItem('player_name', cleanName);
    } catch (e) {}

    this.ui.clearLoginError();
    this.ui.setPlayerName(cleanName, sticker);
    this.ui.showScreen('screen-menu');
  }

  private startMatch() {
    if (this.isOnline) {
      this.socket?.emit('startMatch', (res: any) => {
        if (res && !res.success) {
          alert(res.error || 'Chỉ chủ phòng mới có quyền bắt đầu trận đấu!');
        }
      });
    }
  }

  private refreshRooms() {
    this.socket?.emit('getRooms', (rooms: any[]) => {
      this.ui.renderRoomList(rooms);
    });
  }

  private createRoom(data: {
    roomName: string;
    password?: string;
    mode: string;
    maxPlayers: number;
    matchDuration: number;
    botCount: number;
    botDifficulty: string;
    boMode?: string;
    sticker?: string;
  }) {
    const trimmedRoomName = (data.roomName || '').trim();
    if (!trimmedRoomName) {
      alert('Vui lòng nhập tên phòng!');
      this.ui.showModal('modal-create-room');
      return;
    }

    this.socket?.emit(
      'createRoom',
      {
        roomName: trimmedRoomName,
        password: data.password,
        mode: data.mode,
        maxPlayers: data.maxPlayers,
        matchDuration: data.matchDuration,
        botCount: data.botCount,
        botDifficulty: data.botDifficulty,
        boMode: data.boMode || 'BO1',
        sticker: data.sticker || this.playerSticker,
      },
      (res: any) => {
        if (res && res.success) {
          this.joinRoom(res.roomId, data.sticker || this.playerSticker, data.password);
        } else if (res && !res.success && res.error) {
          this.ui.showModal('modal-create-room');
        }
      }
    );
  }

  private joinRoom(roomId: string, sticker?: string, password?: string) {
    this.socket?.emit(
      'joinRoom',
      {
        roomId,
        playerName: this.playerName,
        password: password,
        sticker: sticker || this.playerSticker,
      },
      (res: any) => {
        if (res.success) {
          this.isOnline = true;
          this.isOffline = false;
          this.ui.setOfflineModeUI(false);
          this.roomId = roomId;
          this.maze = res.maze;
          this.roomConfig = res.config;
          this.players = [];
          this.bullets = [];
          this.powerups = [];
          this.localPlayerId = this.socket?.id || '';
          this.lastFrameTime = performance.now();

          this.ui.resetRoomUI(res.config?.mode, res.config?.name || roomId);

          if (Array.isArray(res.chatHistory)) {
            res.chatHistory.forEach((chatMsg: any) => {
              this.ui.appendChatMessage(chatMsg, true);
            });
          }

          this.ui.showScreen('screen-game');
          this.inputManager.setInGame(true);
          this.handleCanvasResizeImmediate();
        } else {
          alert(res.error || 'Không thể vào phòng!');
        }
      }
    );
  }

  private startOfflineGame() {
    this.isOnline = false;
    this.isOffline = true;
    this.ui.setOfflineModeUI(true);
    this.maze = PhysicsEngine.generateMaze(9, 7, 100);

    // Setup 1 Player vs 1 Bot in Offline Quick Play (1 vs Bot) with pastel colors
    const playerColor = TANK_COLORS[0].body; // '#f472b6' (Hồng phấn)
    const botColor = TANK_COLORS[3].body;    // '#4ade80' (Xanh bạc hà)
    const botSticker = this.playerSticker === '🤖' ? '🐥' : '🤖';

    this.players = [
      {
        id: 'p1_local',
        name: `${this.playerName}`,
        sticker: this.playerSticker,
        x: 150,
        y: 150,
        bodyAngle: 0,
        turretAngle: 0,
        radius: 18,
        moveSpeed: 150,
        color: playerColor,
        hp: 1,
        maxHp: 1,
        score: 0,
        kills: 0,
        deaths: 0,
        lastShotTime: 0,
        shootCooldown: 1.0,
      },
      {
        id: 'bot_off_1',
        name: 'Bot AI (1 vs 1)',
        sticker: botSticker,
        isBot: true,
        difficulty: 'smart',
        x: 750,
        y: 550,
        bodyAngle: Math.PI,
        turretAngle: Math.PI,
        radius: 18,
        moveSpeed: 145,
        color: botColor,
        hp: 1,
        maxHp: 1,
        score: 0,
        kills: 0,
        deaths: 0,
        lastShotTime: 0,
        shootCooldown: 1.0,
      },
    ];

    this.bullets = [];
    this.laserBeams = [];
    this.powerups = [];
    this.effects = new EffectsManager();
    this.lastOfflinePowerup = Date.now();
    this.nextOfflinePowerupInterval = 10000;

    // Sinh sẵn 3 vật phẩm khởi đầu cho trận đấu offline (tự biến mất sau 18s)
    const initialTypes = ['speed', 'shield', 'fastBullet', 'bigBullet', 'rapidFire', 'crazyBounce', 'laser', 'heart'];
    const shuffled = [...initialTypes].sort(() => 0.5 - Math.random());
    for (let i = 0; i < 3; i++) {
      const pos = this.getOfflinePowerupSpawnPoint();
      this.powerups.push({
        id: `pw_off_init_${Date.now()}_${i}`,
        x: pos.x,
        y: pos.y,
        type: shuffled[i],
        createdAt: Date.now(),
        expiresAt: Date.now() + 18000,
      });
    }

    this.roomConfig = { name: 'Chơi Offline (1 vs Bot)', mode: 'deathmatch' };
    this.ui.resetRoomUI('deathmatch', 'Chơi Offline (1 vs Bot)');
    this.ui.updateWaitingRoomState('playing', false, 0, 0);
    this.ui.setHostStatus(false);
    this.timeRemaining = 180;
    this.ui.showMatchTimer();
    this.ui.updateMatchTimer(this.timeRemaining);
    const bannerDuration = 2000;
    const now = Date.now();
    this.startTime = now + bannerDuration;
    this.freezeUntil = this.startTime;
    this.matchState = 'preparing';
    this.latestStatus = 'preparing';
    this.roundAnnouncement = {
      type: 'preparation',
      mainText: 'TRẬN ĐẤU BẮT ĐẦU!',
      subText: '',
      color: '#f472b6',
      strokeColor: '#db2777',
      expiresAt: this.startTime,
    };
    soundEngine.playMatchStart?.();
    this.lastFrameTime = performance.now();

    if (this.offlineStartTimeout) {
      clearTimeout(this.offlineStartTimeout);
    }
    this.offlineStartTimeout = setTimeout(() => {
      if (this.isOffline && this.matchState === 'preparing') {
        this.matchState = 'playing';
        this.latestStatus = 'playing';
        this.roundAnnouncement = null;
      }
    }, bannerDuration);

    this.ui.showScreen('screen-game');
    this.inputManager.setInGame(true);
    this.handleCanvasResizeImmediate();
  }

  private leaveGame() {
    if (this.offlineStartTimeout) {
      clearTimeout(this.offlineStartTimeout);
      this.offlineStartTimeout = null;
    }
    if (this.endGameTimer) {
      clearTimeout(this.endGameTimer);
      this.endGameTimer = null;
    }
    this.ui.hideModal('modal-mvp');
    if (this.isOnline) {
      this.socket?.emit('leaveRoom');
    }
    this.isOnline = false;
    this.isOffline = false;
    this.players = [];
    this.bullets = [];
    this.powerups = [];
    this.roomConfig = null;
    this.ui.setOfflineModeUI(false);
    this.ui.resetRoomUI();
    this.inputManager.setInGame(false);
    this.ui.showScreen('screen-menu');
  }

  private restartMatch() {
    if (this.isOnline) {
      this.socket?.emit('resetMatch');
    } else if (this.isOffline) {
      this.startOfflineGame();
    }
  }

  private distToSegment(p: { x: number; y: number }, v: { x: number; y: number }, w: { x: number; y: number }): number {
    const l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  private getOfflinePowerupSpawnPoint(): { x: number; y: number } {
    if (!this.maze) {
      return { x: 450, y: 350 };
    }
    const cols = this.maze.cols || 9;
    const rows = this.maze.rows || 7;
    const cellSize = this.maze.cellSize || 100;

    let bestPoint = { x: 450, y: 350 };
    let maxMinDist = -1;

    // Try up to 40 attempts to find a spot that is far from other powerups (>= 80-100px) and not on top of a player
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = Math.floor(Math.random() * cols);
      const r = Math.floor(Math.random() * rows);
      const candX = c * cellSize + cellSize / 2;
      const candY = r * cellSize + cellSize / 2;

      // Distance to existing powerups
      let minDist = 99999;
      for (const pw of this.powerups) {
        const d = Math.hypot(candX - pw.x, candY - pw.y);
        if (d < minDist) minDist = d;
      }

      // Distance to living players
      let playerDist = 99999;
      for (const p of this.players) {
        if (p.hp > 0) {
          const d = Math.hypot(candX - p.x, candY - p.y);
          if (d < playerDist) playerDist = d;
        }
      }

      if (this.powerups.length === 0 && playerDist > 60) {
        return { x: candX, y: candY };
      }

      // Must be at least 90px away from other powerups and not on top of player
      if (minDist >= 90 && playerDist > 50) {
        return { x: candX, y: candY };
      }

      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestPoint = { x: candX, y: candY };
      }
    }

    return bestPoint;
  }

  private updateOfflineGame(dt: number) {
    if (this.matchState !== 'playing') {
      return;
    }

    const now = Date.now();
    const inputState = this.inputManager.update();

    // 0. Powerup Spawning & Lifecycle (Cứ mỗi 10 giây sinh thêm 1 vật phẩm, tối đa 5 vật phẩm trên map, tự biến mất sau 18s)
    if (!this.lastOfflinePowerup) {
      this.lastOfflinePowerup = now;
      this.nextOfflinePowerupInterval = 10000;
    }
    if (now - this.lastOfflinePowerup >= 10000) {
      this.lastOfflinePowerup = now;
      this.nextOfflinePowerupInterval = 10000;

      if (this.powerups.length < 5) {
        const allTypes = ['speed', 'shield', 'fastBullet', 'bigBullet', 'rapidFire', 'crazyBounce', 'laser', 'heart'];
        const existingTypes = this.powerups.map((p) => p.type);
        const unusedTypes = allTypes.filter((t) => !existingTypes.includes(t));
        const pool = unusedTypes.length > 0 ? unusedTypes : allTypes;
        const selectedType = pool[Math.floor(Math.random() * pool.length)];
        const pos = this.getOfflinePowerupSpawnPoint();

        this.powerups.push({
          id: `pw_off_${now}_${Math.random()}`,
          x: pos.x,
          y: pos.y,
          type: selectedType,
          createdAt: now,
          expiresAt: now + 18000,
        });
      }
    }

    // Filter expired powerups
    this.powerups = this.powerups.filter((pw) => !pw.expiresAt || pw.expiresAt > now);

    // Powerup Buff Expiration on Players (Nhóm 2 Hiệu Ứng)
    for (const p of this.players) {
      if (p.shieldTimer && now > p.shieldTimer) {
        p.shieldTimer = undefined;
      }
      if (p.speedTimer && now > p.speedTimer) {
        p.speedTimer = undefined;
      }
      if (p.rapidFireTimer && now > p.rapidFireTimer) {
        p.rapidFireTimer = undefined;
      }
      if (p.activePowerup && p.powerupTimer && now > p.powerupTimer) {
        p.activePowerup = undefined;
        p.powerupTimer = undefined;
      }
    }

    // Powerup Pickup Collision Detection
    const remainingPowerups: any[] = [];
    for (const pw of this.powerups) {
      let collected = false;
      for (const tank of this.players) {
        if (tank.hp <= 0) continue;
        const dist = Math.hypot(tank.x - pw.x, tank.y - pw.y);
        if (dist < tank.radius + 15) {
          collected = true;
          soundEngine.playPowerup();

          let title = 'Vật Phẩm';
          let color = '#38bdf8';

          switch (pw.type) {
            // Nhóm 1 - ĐẠN (Cấp chính xác 5 VIÊN ĐẠN đặc biệt, bắn trừ dần, nhặt đạn mới ghi đè & reset 5 viên, VIẾT HOA TOÀN BỘ)
            case 'fastBullet':
              tank.activeBulletType = 'fastBullet';
              tank.specialAmmo = 5;
              tank.activePowerup = 'fastBullet';
              title = '🔥 ĐẠN SIÊU TỐC (5)';
              color = '#ef4444';
              break;
            case 'bigBullet':
            case 'piercing':
              tank.activeBulletType = 'bigBullet';
              tank.specialAmmo = 5;
              tank.activePowerup = 'bigBullet';
              title = '💣 ĐẠN CỠ LỚN (5)';
              color = '#a855f7';
              break;
            case 'crazyBounce':
            case 'bounce':
            case 'ricochet':
              tank.activeBulletType = 'crazyBounce';
              tank.specialAmmo = 5;
              tank.activePowerup = 'crazyBounce';
              title = '🪃 ĐẠN SIÊU NẢY (5)';
              color = '#10b981';
              break;
            case 'laser':
              tank.activeBulletType = 'laser';
              tank.specialAmmo = 5;
              tank.activePowerup = 'laser';
              title = '⚡ ĐẠN LASER (5)';
              color = '#f87171';
              break;

            // Nhóm 2 - HIỆU ỨNG (Timer độc lập, cộng dồn song song, Viết Hoa Chữ Cái Đầu)
            case 'shield':
              tank.shieldTimer = now + 10000;
              title = '🛡️ Khiên Bảo Vệ';
              color = '#3b82f6';
              break;
            case 'speed':
              tank.speedTimer = now + 10000;
              title = '⚡ Tăng Tốc Độ';
              color = '#facc15';
              break;
            case 'rapidFire':
              tank.rapidFireTimer = now + 10000;
              title = '⏱️ Bắn Liên Tục';
              color = '#ec4899';
              break;

            // Nhóm 3 - NỘI TẠI (Tồn tại vĩnh viễn đến khi bị bắn trúng, viết thường toàn bộ)
            case 'heart':
            case 'extraLife':
              tank.extraLife = true;
              tank.extraLives = 1;
              title = '❤️ mạng phụ';
              color = '#f43f5e';
              break;
          }

          this.effects.addFloatingText(`+${title}`, pw.x, pw.y, color, 18);
          break;
        }
      }
      if (!collected) {
        remainingPowerups.push(pw);
      }
    }
    this.powerups = remainingPowerups;

    // 1. Process P1 Input (Aggregated across Keyboard/Mouse, Touch, Gamepad)
    const p1 = this.players.find((p) => p.id === 'p1_local');
    if (p1 && p1.hp > 0) {
      if (inputState.joystickActive && inputState.intensity > 0) {
        this.moveTankDirect(p1, inputState.targetAngle, inputState.intensity, dt);
      } else {
        p1.turretAngle = p1.bodyAngle;
        this.moveTank(p1, inputState.forward, inputState.backward, inputState.turnLeft, inputState.turnRight, dt);
      }

      if (inputState.shoot) {
        this.fireOfflineBullet(p1, now);
      }
    }

    // 2. Process Hunter Bots (100% focused on hunting & destroying player - no powerup distraction)
    for (const p of this.players) {
      if (p.isBot && p.hp > 0) {
        const botInput = BotAI.updateBot(p, this.players, this.bullets, this.maze.walls, [], 900, 700, now);
        p.turretAngle = botInput.turretTargetAngle;
        this.moveTank(p, botInput.forward, botInput.backward, botInput.turnLeft, botInput.turnRight, dt);
        if (botInput.shoot) {
          this.fireOfflineBullet(p, now);
        }
      }
    }

    // 3. Process Bullets & Bouncing Physics
    const activeBullets: any[] = [];
    for (const b of this.bullets) {
      const res = PhysicsEngine.processBulletRicochet(b, this.maze.walls, dt);
      if (res.bounced) {
        soundEngine.playBounce();
        this.effects.triggerSparkBounce(res.hitPoint?.x || b.x, res.hitPoint?.y || b.y, res.normal || { x: 0, y: 0 });
      }

      if (b.bounces > b.maxBounces) continue;

      // Bullet vs Tank collision
      let hit = false;
      for (const tank of this.players) {
        if (tank.hp <= 0) continue;

        // Bỏ qua va chạm giữa đạn với xe người bắn trong 120ms đầu tiên sau khi bắn
        if (b.ownerId === tank.id && now - (b.createdAt || 0) < 120) {
          continue;
        }

        if (PhysicsEngine.checkCircleCollision({ x: b.x, y: b.y, radius: b.radius }, { x: tank.x, y: tank.y, radius: tank.radius })) {
          // Nhóm 2 - 🛡️ Khiên Bảo Vệ: Bất tử hoàn toàn và đạn XUYÊN QUA (không phát nổ, không bị chặn lại)
          const hasShield = (tank.shieldTimer && now < tank.shieldTimer) || tank.activePowerup === 'shield';
          if (hasShield) {
            continue;
          }

          // Nhóm 3 - ❤️ mạng phụ: Đỡ hộ 1 viên đạn chí mạng cứu sống tại chỗ, xe không chết
          if (tank.extraLife || (tank.extraLives && tank.extraLives > 0)) {
            tank.extraLife = false;
            tank.extraLives = 0;
            hit = true;
            soundEngine.playBounce();
            this.effects.triggerSparkBounce(tank.x, tank.y, { x: 0, y: -1 });
            this.effects.addFloatingText('❤️ mạng phụ đỡ đạn!', tank.x, tank.y - 20, '#f43f5e', 16);
            break;
          }

          tank.hp = 0;
          tank.activeBulletType = undefined;
          tank.specialAmmo = 0;
          tank.bulletTimer = undefined;
          tank.shieldTimer = undefined;
          tank.speedTimer = undefined;
          tank.rapidFireTimer = undefined;
          tank.activePowerup = undefined;
          tank.powerupTimer = undefined;
          tank.extraLife = false;
          tank.extraLives = 0;
          tank.deaths = (tank.deaths || 0) + 1;
          tank.score = Math.max(0, (tank.kills || 0) * 100 - (tank.deaths || 0) * 50);
          hit = true;

          soundEngine.playExplosion();
          this.effects.triggerExplosion(tank.x, tank.y, tank.color);

          const shooter = this.players.find((p) => p.id === b.ownerId);
          if (shooter) {
            // Check suicide (bullet.ownerId === victim.id)
            if (shooter.id !== tank.id) {
              shooter.kills = (shooter.kills || 0) + 1;
              shooter.score = Math.max(0, (shooter.kills || 0) * 100 - (shooter.deaths || 0) * 50);
            } else {
              shooter.score = Math.max(0, (shooter.kills || 0) * 100 - (shooter.deaths || 0) * 50);
            }
          }

          this.ui.updateHUD(this.players, 'p1_local');

          // Respawn after 2s
          setTimeout(() => {
            tank.hp = 1;
            tank.x = Math.random() * 700 + 100;
            tank.y = Math.random() * 500 + 100;
          }, 2000);

          break;
        }
      }

      if (!hit) {
        activeBullets.push(b);
      }
    }
    this.bullets = activeBullets;

    // 4. Process Laser Beams: 2-stage Offline physics (BƯỚC 1: 120ms tia nhỏ cảnh báo không sát thương -> BƯỚC 2: 160ms tia to bùng nổ sát thương)
    for (const l of this.laserBeams) {
      if (l.stage === 'aiming' && !l.hasDealtDamage && l.aimStartTime && now >= l.aimStartTime + (l.aimDuration || 120)) {
        l.stage = 'blasted';
        l.blastStartedAt = now;
        l.hasDealtDamage = true;
        l.expiresAt = now + (l.blastDuration || 160);
        soundEngine.playExplosion?.();
        this.effects.triggerLaserFlash(l.x1, l.y1, Math.atan2(l.y2 - l.y1, l.x2 - l.x1));

        const shooter = this.players.find((p) => p.id === l.shooterId);

        for (const tank of this.players) {
          if (tank.id === l.shooterId || tank.hp <= 0) continue;

          const targetIsImmune = (tank.shieldTimer && now < tank.shieldTimer) ||
            tank.activePowerup === 'shield' ||
            (tank.spawnInvincibleTimer && now < tank.spawnInvincibleTimer);
          if (targetIsImmune) continue;

          const dist = this.distToSegment({ x: tank.x, y: tank.y }, { x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 });
          if (dist <= tank.radius + 14) {
            if (tank.extraLife || (tank.extraLives && tank.extraLives > 0)) {
              tank.extraLife = false;
              tank.extraLives = 0;
              soundEngine.playBounce();
              this.effects.triggerSparkBounce(tank.x, tank.y, { x: 0, y: -1 });
              this.effects.addFloatingText('❤️ mạng phụ đỡ đạn!', tank.x, tank.y - 20, '#f43f5e', 16);
            } else {
              tank.hp = 0;
              tank.activeBulletType = undefined;
              tank.specialAmmo = 0;
              tank.shieldTimer = undefined;
              tank.speedTimer = undefined;
              tank.rapidFireTimer = undefined;
              tank.activePowerup = undefined;
              tank.powerupTimer = undefined;
              tank.extraLife = false;
              tank.extraLives = 0;
              tank.deaths = (tank.deaths || 0) + 1;
              tank.score = Math.max(0, (tank.kills || 0) * 100 - (tank.deaths || 0) * 50);

              if (shooter) {
                shooter.kills = (shooter.kills || 0) + 1;
                shooter.score = Math.max(0, (shooter.kills || 0) * 100 - (shooter.deaths || 0) * 50);
              }

              soundEngine.playExplosion();
              this.effects.triggerExplosion(tank.x, tank.y, tank.color);
              this.effects.triggerLaserFlash(l.x1, l.y1, Math.atan2(l.y2 - l.y1, l.x2 - l.x1));
              this.ui.updateHUD(this.players, 'p1_local');

              setTimeout(() => {
                tank.hp = 1;
                tank.x = Math.random() * 700 + 100;
                tank.y = Math.random() * 500 + 100;
              }, 2000);
            }
          }
        }
      }
    }

    this.laserBeams = this.laserBeams.filter((l) => (l.expiresAt || 0) > now);

    // 5. Offline Match Countdown & Time-up Win Condition (Chơi liên tục đến khi hết giờ 00:00)
    if (this.timeRemaining > 0) {
      this.timeAccumulator = (this.timeAccumulator || 0) + dt;
      if (this.timeAccumulator >= 1.0) {
        this.timeAccumulator -= 1.0;
        this.timeRemaining = Math.max(0, this.timeRemaining - 1);
        this.ui.updateMatchTimer(this.timeRemaining);

        if (this.timeRemaining <= 10 && this.timeRemaining > 0) {
          soundEngine.playCountdownBeep?.();
        }

        if (this.timeRemaining <= 0) {
          // Hết giờ: Người chơi có tổng điểm/mạng hạ gục cao nhất chiến thắng
          const sorted = [...this.players].sort((a, b) => {
            const scoreA = Math.max(0, (a.kills || 0) * 100 - (a.deaths || 0) * 50);
            const scoreB = Math.max(0, (b.kills || 0) * 100 - (b.deaths || 0) * 50);
            if (scoreB !== scoreA) return scoreB - scoreA;
            return (b.kills || 0) - (a.kills || 0);
          });
          const top = sorted[0];
          const topScore = Math.max(0, (top.kills || 0) * 100 - (top.deaths || 0) * 50);

          soundEngine.playVictory?.();
          this.ui.showMVPModal({
            mvp: {
              id: top.id,
              name: top.name,
              sticker: top.sticker || (top.isBot ? '🤖' : '🐥'),
              score: topScore,
              kills: top.kills || 0,
              deaths: top.deaths || 0,
              team: top.team,
            },
            winner: { id: top.id, name: top.name, score: topScore },
            scores: this.players,
            config: { mode: 'deathmatch' },
          });

          this.endGameTimer = setTimeout(() => {
            this.leaveGame();
          }, 6000);
        }
      }
    }

    this.ui.updateHUD(this.players, 'p1_local');
  }

  private moveTankDirect(tank: any, targetAngle: number, intensity: number, dt: number) {
    const now = Date.now();
    const baseSpeed = tank.moveSpeed || tank.speed || 150;
    const isSpeed = (tank.speedTimer && now < tank.speedTimer) || tank.activePowerup === 'speed';
    const moveSpeed = isSpeed ? baseSpeed * 1.4 : baseSpeed;
    const clampedIntensity = Math.min(1, Math.max(0, intensity));

    tank.bodyAngle = targetAngle;
    tank.turretAngle = targetAngle;

    if (clampedIntensity > 0) {
      const moveX = Math.cos(targetAngle) * moveSpeed * clampedIntensity * dt;
      const moveY = Math.sin(targetAngle) * moveSpeed * clampedIntensity * dt;

      this.effects.addTreadMark(tank.x, tank.y, tank.bodyAngle, tank.color);

      const newPos = { x: tank.x + moveX, y: tank.y + moveY, radius: tank.radius };
      for (const wall of this.maze.walls) {
        const res = PhysicsEngine.resolveCircleWallCollision(newPos, wall);
        if (res.collided) {
          newPos.x = res.x;
          newPos.y = res.y;
        }
      }

      tank.x = Math.max(tank.radius, Math.min(this.maze.width - tank.radius, newPos.x));
      tank.y = Math.max(tank.radius, Math.min(this.maze.height - tank.radius, newPos.y));
    }
  }

  private moveTank(tank: any, forward: boolean, backward: boolean, turnLeft: boolean, turnRight: boolean, dt: number) {
    const now = Date.now();
    const turnRate = tank.turnRate || 2.0;
    const baseSpeed = tank.moveSpeed || tank.speed || 150;
    const isSpeed = (tank.speedTimer && now < tank.speedTimer) || tank.activePowerup === 'speed';
    const moveSpeed = isSpeed ? baseSpeed * 1.4 : baseSpeed;
    if (turnLeft) tank.bodyAngle -= turnRate * dt;
    if (turnRight) tank.bodyAngle += turnRate * dt;

    let moveX = 0;
    let moveY = 0;
    if (forward) {
      moveX += Math.cos(tank.bodyAngle) * moveSpeed * dt;
      moveY += Math.sin(tank.bodyAngle) * moveSpeed * dt;
      this.effects.addTreadMark(tank.x, tank.y, tank.bodyAngle, tank.color);
    }
    if (backward) {
      moveX -= Math.cos(tank.bodyAngle) * moveSpeed * 0.6 * dt;
      moveY -= Math.sin(tank.bodyAngle) * moveSpeed * 0.6 * dt;
    }

    const newPos = { x: tank.x + moveX, y: tank.y + moveY, radius: tank.radius };
    for (const wall of this.maze.walls) {
      const res = PhysicsEngine.resolveCircleWallCollision(newPos, wall);
      if (res.collided) {
        newPos.x = res.x;
        newPos.y = res.y;
      }
    }

    tank.x = newPos.x;
    tank.y = newPos.y;
    tank.turretAngle = tank.bodyAngle;
  }

  private fireOfflineBullet(player: any, now: number) {
    const hasSpecialAmmo = Boolean(player.activeBulletType && (player.specialAmmo === undefined || player.specialAmmo > 0));
    const bulletType = hasSpecialAmmo ? player.activeBulletType : undefined;

    const isRapid = (player.rapidFireTimer && now < player.rapidFireTimer) || player.activePowerup === 'rapidFire';
    const isLaser = bulletType === 'laser' || player.activeBulletType === 'laser' || player.activePowerup === 'laser';

    // Thời gian nạp đạn (shootCooldown):
    // Khi đang sở hữu buff Laser: 0.9s (900ms)
    // Khi có buff Bắn nhanh (Rapid Fire): 0.4s (400ms)
    // Mặc định: 1.0s (1000ms)
    let cooldownSec = player.shootCooldown || 1.0;
    if (isLaser) {
      cooldownSec = 0.9;
    } else if (isRapid) {
      cooldownSec = 0.4;
    }

    if (now - (player.lastShotTime || 0) < cooldownSec * 1000) return;
    player.lastShotTime = now;

    // Nhóm 1 - ĐẠN (Cơ chế 5 viên đạn đặc biệt)
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

    // ⚡ ĐẠN LASER: Cơ chế 2 giai đoạn (BƯỚC 1: Tia nhỏ 120ms 0 sát thương -> BƯỚC 2: Tia nổ sát thương cực đại 160ms)
    if (bulletType === 'laser') {
      const barrelLen = player.radius + 14;
      const bx = player.x + Math.cos(player.turretAngle) * barrelLen;
      const by = player.y + Math.sin(player.turretAngle) * barrelLen;
      const hitResult = PhysicsEngine.raycastLaser(
        bx,
        by,
        player.turretAngle,
        this.maze.walls,
        900,
        700,
        2000
      );

      const laserAimDuration = 120; // 120ms: Tia ngắm cảnh báo đỏ mảnh, KHÔNG gây sát thương
      const laserBlastDuration = 160; // 160ms: Tia to bùng nổ, MỚI chính thức tính sát thương
      this.laserBeams.push({
        id: `offline_laser_${Date.now()}_${Math.random()}`,
        shooterId: player.id,
        shooterColor: player.color,
        x1: bx,
        y1: by,
        x2: hitResult.x,
        y2: hitResult.y,
        color: '#ef4444',
        createdAt: now,
        stage: 'aiming',
        aimStartTime: now,
        aimDuration: laserAimDuration,
        blastDuration: laserBlastDuration,
        expiresAt: now + laserAimDuration + laserBlastDuration,
        hasDealtDamage: false,
      });

      soundEngine.playShoot?.();
      return;
    }

    // Nhóm 1: 🔥 ĐẠN SIÊU TỐC, 💣 ĐẠN CỠ LỚN, 🪃 ĐẠN SIÊU NẢY, hoặc đạn thường mặc định
    const isFast = bulletType === 'fastBullet';
    const isBig = bulletType === 'bigBullet' || bulletType === 'piercing';
    const isBounce = bulletType === 'crazyBounce' || bulletType === 'bounce' || bulletType === 'ricochet';

    const speed = isFast ? 520 : 380;
    const radius = isBig ? 15 : 5; // Đạn cỡ lớn x3 bán kính (từ 5px -> 15px)
    const maxBounces = isBounce ? 10 : 3;
    const bulletColor = isBounce
      ? '#10b981'
      : isBig
      ? '#a855f7'
      : isFast
      ? '#ef4444'
      : (player.color || '#f472b6');

    // Khắc phục lỗi tự nổ của Đạn Cỡ Lớn:
    // Tăng spawn offset ở đầu nòng xe = bán kính xe + bán kính đạn + 8px
    const spawnOffset = player.radius + radius + 8;
    const bx = player.x + Math.cos(player.turretAngle) * spawnOffset;
    const by = player.y + Math.sin(player.turretAngle) * spawnOffset;

    const bullet = {
      id: `b_off_${this.offlineBulletCounter++}`,
      ownerId: player.id,
      x: bx,
      y: by,
      vx: Math.cos(player.turretAngle) * speed,
      vy: Math.sin(player.turretAngle) * speed,
      radius,
      bounces: 0,
      maxBounces,
      color: bulletColor,
      createdAt: now, // Dùng để bỏ qua va chạm với xe bắn trong 120ms đầu
    };

    this.bullets.push(bullet);
    soundEngine.playShoot();
    this.effects.triggerMuzzleFlash(bx, by, player.turretAngle);
  }

  private sendOnlineInput() {
    if (!this.isOnline || !this.socket || this.seriesWinCelebration) return;

    // Khóa phím khi không ở trạng thái 'playing' (chỉ mở khóa duy nhất khi server chuyển status === 'playing')
    if (this.latestStatus !== 'playing') {
      const myTank = this.players.find((p) => p.id === this.socket?.id);
      const tankAngle = myTank ? (myTank.bodyAngle ?? 0) : 0;
      this.socket.emit('playerInput', {
        forward: false,
        backward: false,
        turnLeft: false,
        turnRight: false,
        turretAngle: tankAngle,
        shoot: false,
        joystickActive: false,
        targetAngle: 0,
        intensity: 0,
      });
      return;
    }

    const inputState = this.inputManager.update();
    const myTank = this.players.find((p) => p.id === this.socket?.id);
    const tankAngle = myTank ? (myTank.bodyAngle ?? 0) : 0;

    const inputData = {
      forward: inputState.forward,
      backward: inputState.backward,
      turnLeft: inputState.turnLeft,
      turnRight: inputState.turnRight,
      turretAngle: tankAngle, // No independent turret: gun is fixed to tank chassis
      shoot: inputState.shoot,
      joystickActive: inputState.joystickActive,
      targetAngle: inputState.targetAngle,
      intensity: inputState.intensity,
    };

    this.socket.emit('playerInput', inputData);
  }

  private updateOnlinePlayerInterpolation(dt: number) {
    const myId = this.socket?.id;
    for (const tank of this.players) {
      if (tank.id === myId) {
        // Authoritative Server Reconciliation & Smooth Rubberbanding
        PlayerNetworkController.reconcileLocalPlayer(tank, dt);
      } else {
        // Smooth Interpolation for remote human players & AI bots
        PlayerNetworkController.interpolateRemotePlayer(tank, dt);
      }
    }
  }

  private gameLoop(now: number) {
    try {
      if (!this.lastFrameTime) {
        this.lastFrameTime = now;
      }
      const rawDt = (now - this.lastFrameTime) / 1000;
      const dt = Math.min(Math.max(rawDt, 0), 0.1);
      this.lastFrameTime = now;

      // FPS Counter
      this.frameCount++;
      if (now - this.lastFpsUpdate >= 1000) {
        this.fps = this.frameCount;
        this.frameCount = 0;
        this.lastFpsUpdate = now;
        this.ui.updateMetrics(this.fps, this.ping);
      }

      // Logic updates
      if (this.isOnline) {
        this.sendOnlineInput();
        this.updateOnlinePlayerInterpolation(dt);
      } else if (this.isOffline) {
        this.updateOfflineGame(dt);
      }

      this.mapRenderer.update(dt);
      this.effects.update(dt);

      // Rendering: keeps rendering continuously under all game states (including round_paused)
      this.render();
    } catch (err) {
      console.error('[Game] Error in gameLoop:', err);
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  private render() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();

    if (this.maze) {
      // 1. Grid & Maze Walls
      this.mapRenderer.renderGrid(this.ctx, this.maze.width, this.maze.height, this.maze.cellSize);
      this.effects.renderTreads(this.ctx);
      this.mapRenderer.renderWalls(this.ctx, this.maze.walls);
      this.mapRenderer.renderPowerups(this.ctx, this.powerups);

      // 2. Render Tanks
      this.players.forEach((p) => {
        const isMe = p.id === (this.isOnline ? this.socket?.id : 'p1_local');
        const activeEmoji = this.effects.getActiveEmoji(p.id);
        TankRenderer.renderTank(this.ctx, p, isMe, activeEmoji);
      });

      // 3. Render Bullets & Lasers
      this.bullets.forEach((b) => {
        BulletRenderer.renderBullet(this.ctx, b);
      });

      const now = Date.now();
      this.laserBeams = this.laserBeams.filter((b) => {
        if (b.stage === 'blasted') {
          return b.blastStartedAt ? (now - b.blastStartedAt < (b.blastDuration || 160)) : false;
        }
        if (b.stage === 'aiming') {
          return b.aimStartTime ? (now - b.aimStartTime < (b.aimDuration || 120)) : false;
        }
        return (b.expiresAt || 0) > now;
      });

      this.laserBeams.forEach((laser) => {
        const lx1 = Math.floor(laser.x1 || 0);
        const ly1 = Math.floor(laser.y1 || 0);
        const lx2 = Math.floor(laser.x2 || 0);
        const ly2 = Math.floor(laser.y2 || 0);

        this.ctx.save();
        if (laser.stage === 'aiming') {
          // BƯỚC 1 (0ms -> 120ms): Tia Nhỏ (vệt chỉ thị ngắm bắn đỏ mảnh 2.0px, TUYỆT ĐỐI 0 sát thương)
          const pulse = Math.sin(now * 0.05) * 0.25 + 0.75;

          this.ctx.setLineDash([8, 4]);
          this.ctx.beginPath();
          this.ctx.moveTo(lx1, ly1);
          this.ctx.lineTo(lx2, ly2);
          this.ctx.lineWidth = 2.0;
          this.ctx.strokeStyle = `rgba(239, 68, 68, ${pulse * 0.9})`;
          this.ctx.shadowColor = '#ef4444';
          this.ctx.shadowBlur = 8;
          this.ctx.stroke();

          // Điểm tụ năng lượng đỏ ở đầu nòng và điểm ngắm
          this.ctx.setLineDash([]);
          this.ctx.beginPath();
          this.ctx.arc(lx1, ly1, 4, 0, Math.PI * 2);
          this.ctx.arc(lx2, ly2, 3.5, 0, Math.PI * 2);
          this.ctx.fillStyle = '#ef4444';
          this.ctx.shadowColor = '#ef4444';
          this.ctx.shadowBlur = 10;
          this.ctx.fill();
        } else if (laser.stage === 'blasted') {
          // BƯỚC 2 (Sau 120ms): Tia To (chùm năng lượng cực đại 160ms, CHỈ vẽ khi Server emit laserBlasted / nổ sát thương)
          // 1. Lớp hào quang ngoài bùng sáng (Neon Red Glow)
          this.ctx.beginPath();
          this.ctx.moveTo(lx1, ly1);
          this.ctx.lineTo(lx2, ly2);
          this.ctx.lineWidth = 18;
          this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
          this.ctx.shadowColor = '#ef4444';
          this.ctx.shadowBlur = 24;
          this.ctx.stroke();

          // 2. Tia trung tâm neon
          this.ctx.beginPath();
          this.ctx.moveTo(lx1, ly1);
          this.ctx.lineTo(lx2, ly2);
          this.ctx.lineWidth = 9;
          this.ctx.strokeStyle = '#fca5a5';
          this.ctx.stroke();

          // 3. Lõi trắng chói lóa tức thì
          this.ctx.beginPath();
          this.ctx.moveTo(lx1, ly1);
          this.ctx.lineTo(lx2, ly2);
          this.ctx.lineWidth = 3.5;
          this.ctx.strokeStyle = '#ffffff';
          this.ctx.shadowColor = '#ffffff';
          this.ctx.shadowBlur = 12;
          this.ctx.stroke();
        }
        this.ctx.restore();
      });

      // 4. Render Particle Effects & Circle Danger Zone (Vòng Bo Tròn)
      if (this.roomConfig?.mode === 'teambattle' && this.timeRemaining <= 20 && this.timeRemaining > 0) {
        this.mapRenderer.renderDangerZone(this.ctx, this.maze.width, this.maze.height, this.timeRemaining, this.roomConfig?.mode);
      }

      this.effects.renderParticles(this.ctx);

      // 5. Canvas HUD Header: Display Room Name
      const currentRoomName = this.isOffline ? 'Offline (Bot AI)' : (this.roomConfig?.name || 'Phòng Xe Tăng AZ');
      this.ctx.save();
      this.ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
      this.ctx.fillStyle = '#f472b6';
      this.ctx.shadowColor = '#db2777';
      this.ctx.shadowBlur = 6;
      this.ctx.fillText(`PHÒNG: ${currentRoomName}`, 14, 24);
      this.ctx.restore();

      // 6. Center Canvas Announcement (Text thông báo BẮT ĐẦU HIỆP X / ĐỘI THẮNG HIỆP NÀY)
      const shouldDrawAnnouncement = this.roundAnnouncement && (
        (this.roundAnnouncement.type === 'preparation' && (this.isOnline ? this.latestStatus === 'preparing' : this.matchState === 'preparing')) ||
        (this.roundAnnouncement.type === 'round_end' && Date.now() < this.roundAnnouncement.expiresAt) ||
        (!this.roundAnnouncement.type && Date.now() < this.roundAnnouncement.expiresAt)
      );

      if (shouldDrawAnnouncement && this.roundAnnouncement) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        this.ctx.save();

        const boxW = Math.min(540, this.canvas.width - 40);
        const boxH = this.roundAnnouncement.subText ? 84 : 56;
        const rx = cx - boxW / 2;
        const ry = cy - boxH / 2;

        // Card backdrop
        this.ctx.beginPath();
        if (typeof (this.ctx as any).roundRect === 'function') {
          (this.ctx as any).roundRect(rx, ry, boxW, boxH, 16);
        } else {
          this.ctx.rect(rx, ry, boxW, boxH);
        }
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
        this.ctx.fill();
        this.ctx.lineWidth = 2.5;
        const strokeClr = (this.roundAnnouncement as any).strokeColor || this.roundAnnouncement.color;
        this.ctx.strokeStyle = strokeClr;
        this.ctx.shadowColor = strokeClr;
        this.ctx.shadowBlur = 18;
        this.ctx.stroke();

        // Main Title
        this.ctx.font = '900 24px "Plus Jakarta Sans", sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillStyle = this.roundAnnouncement.color;
        this.ctx.shadowColor = this.roundAnnouncement.color;
        this.ctx.shadowBlur = 10;

        const titleY = this.roundAnnouncement.subText ? cy - 14 : cy;
        this.ctx.fillText(this.roundAnnouncement.mainText, cx, titleY);

        // Subtitle
        if (this.roundAnnouncement.subText) {
          this.ctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
          this.ctx.fillStyle = '#f8fafc';
          this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
          this.ctx.shadowBlur = 4;
          this.ctx.fillText(this.roundAnnouncement.subText, cx, cy + 18);
        }

        this.ctx.restore();
      }

      // 7. Center Canvas Fallback: Series Win Champion Overlay
      if (this.seriesWinCelebration) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const data = this.seriesWinCelebration;
        const winnerTeam = data?.winnerTeam || data?.winningTeam;
        const isRed = winnerTeam === 'red';
        const isBlue = winnerTeam === 'blue';
        const titleColor = isRed ? '#f87171' : isBlue ? '#60a5fa' : '#facc15';
        const teamName = isRed ? '🔴 ĐỘI ĐỎ' : isBlue ? '🔵 ĐỘI XANH' : '🤝 HÒA';

        this.ctx.save();
        const boxW = Math.min(600, this.canvas.width - 30);
        const boxH = 150;
        const rx = cx - boxW / 2;
        const ry = cy - boxH / 2;

        this.ctx.beginPath();
        if (typeof (this.ctx as any).roundRect === 'function') {
          (this.ctx as any).roundRect(rx, ry, boxW, boxH, 20);
        } else {
          this.ctx.rect(rx, ry, boxW, boxH);
        }
        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        this.ctx.fill();
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = titleColor;
        this.ctx.shadowColor = titleColor;
        this.ctx.shadowBlur = 24;
        this.ctx.stroke();

        // Trophy emoji
        this.ctx.font = '32px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('🏆', cx, cy - 40);

        // Win Title
        this.ctx.font = '900 22px "Plus Jakarta Sans", sans-serif';
        this.ctx.fillStyle = titleColor;
        this.ctx.fillText(`🏆 CHIẾN THẮNG CHUNG CUỘC: ${teamName}`, cx, cy - 6);

        // Score subtitle
        const score = data?.finalScore || data?.seriesScore;
        if (score) {
          const targetWins = data?.winsNeeded || (data?.boMode === 'BO3' || data?.boMode === '3' ? 3 : data?.boMode === 'BO5' || data?.boMode === '5' ? 5 : 1);
          this.ctx.font = '800 15px "Plus Jakarta Sans", sans-serif';
          this.ctx.fillStyle = '#fde047';
          this.ctx.fillText(`Tỉ số: 🔴 ${score.red ?? 0} - ${score.blue ?? 0} 🔵 (Chạm ${targetWins})`, cx, cy + 24);
        }

        // Winning members (supports objects or strings)
        let memberNames = '';
        if (Array.isArray(data?.members) && data.members.length > 0) {
          memberNames = data.members.map((m: any) => `${m.isBot ? '🤖' : '👑'} ${m.name} (${m.kills || 0}K)`).join('  |  ');
        } else if (Array.isArray(data?.winningMembers) && data.winningMembers.length > 0) {
          memberNames = data.winningMembers.join('  |  ');
        }

        if (memberNames) {
          this.ctx.font = '700 13px "Plus Jakarta Sans", sans-serif';
          this.ctx.fillStyle = '#e2e8f0';
          this.ctx.fillText(memberNames, cx, cy + 48);
        }

        this.ctx.restore();
      }
    } else {
      // Standby backdrop
      this.ctx.fillStyle = '#0f172a';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.ctx.restore();
  }
}

// Instantiate and start game client when document loads
window.addEventListener('DOMContentLoaded', () => {
  const game = new GameClient();
  game.init();
});
