/**
 * Tank AZ Online - UI Controller
 * Manages menus, room dialogs, setting overlays, HUD scoreboard, FPS/Ping counters, emotes, and audio controls.
 */

let isBotProcessing = false;

function handleBotAction(team: string, action: 'add' | 'remove', callback?: (team: string, difficulty?: string) => void) {
  if (isBotProcessing) return;
  isBotProcessing = true;
  setTimeout(() => { isBotProcessing = false; }, 300);

  const eventName = action === 'add' ? 'addBotToTeam' : 'removeBotFromTeam';
  const difficulty = localStorage.getItem('bot_difficulty') || 'smart';
  console.log(`>>> SINGLE EMIT ${eventName}:`, team, 'difficulty:', difficulty);
  if (callback) {
    callback(team, difficulty);
  } else {
    const socket = (window as any).socket;
    if (socket) {
      socket.emit(eventName, { team, difficulty, botDifficulty: difficulty });
    }
  }
}

function handleAddBot(team: string = 'red') {
  handleBotAction(team, 'add');
}

function handleRemoveBot(team: string = 'red') {
  handleBotAction(team, 'remove');
}

// Global window registration to prevent any Uncaught TypeError from legacy or dynamic calls
(window as any).handleAddBot = handleAddBot;
(window as any).handleRemoveBot = handleRemoveBot;
(window as any).handleBotAction = handleBotAction;
(window as any).changeTeam = (team: string) => {
  const socket = (window as any).socket;
  if (socket) socket.emit('switchTeam', { team });
};
(window as any).switchTeam = (window as any).changeTeam;

export class UIManager {
  callbacks: any;
  fpsCounter: number = 60;
  pingCounter: number = 0;
  selectedSticker: string = '🐥';
  isScoreboardCollapsed: boolean = false;

  constructor(gameCallbacks: any) {
    this.callbacks = gameCallbacks;
    this.fpsCounter = 60;
    this.pingCounter = 0;
    this.initDOM();
    this.hideAllModals();
  }

  private initDOM() {
    // Sticker selection buttons
    const savedSticker = localStorage.getItem('tank_sticker') || '🐥';
    this.selectedSticker = savedSticker;

    const stickerButtons = document.querySelectorAll('.sticker-opt');
    stickerButtons.forEach((btn) => {
      const btnSticker = btn.getAttribute('data-sticker');
      if (btnSticker === this.selectedSticker) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      btn.addEventListener('click', (e) => {
        stickerButtons.forEach((b) => b.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        this.selectedSticker = target.getAttribute('data-sticker') || '🐥';
        try {
          localStorage.setItem('tank_sticker', this.selectedSticker);
        } catch (err) {}
      });
    });

    // Bind main action buttons
    document.getElementById('btn-create-room')?.addEventListener('click', () => this.showModal('modal-create-room'));
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
      this.callbacks.onRefreshRooms();
      this.showModal('modal-join-room');
    });
    document.getElementById('btn-offline-mode')?.addEventListener('click', () => {
      this.callbacks.onStartOffline();
    });
    document.getElementById('btn-settings')?.addEventListener('click', () => this.showModal('modal-settings'));
    
    // Close modals
    document.querySelectorAll('.btn-close-modal').forEach((btn) => {
      btn.addEventListener('click', () => this.hideAllModals());
    });

    // Do not pre-fill or generate random names; keep input field blank if none saved
    const savedUsername = localStorage.getItem('tank_username') || localStorage.getItem('player_name');
    const inputEl = (document.getElementById('input-username') || document.getElementById('input-login-name')) as HTMLInputElement;
    if (savedUsername && inputEl) {
      inputEl.value = savedUsername;
    }

    // Clear error on input typing
    inputEl?.addEventListener('input', () => {
      this.clearLoginError();
    });

    const performLogin = (e?: Event) => {
      if (e) e.preventDefault();
      const usernameInput = (document.getElementById('input-username') || document.getElementById('input-login-name')) as HTMLInputElement;
      const rawValue = usernameInput?.value || '';
      // Chuẩn hóa khoảng trắng: cắt 2 đầu và gom nhiều khoảng trắng ở giữa thành 1 khoảng trắng duy nhất
      const cleanName = rawValue.trim().replace(/\s+/g, ' ');

      // Cập nhật lại input để người chơi thấy rõ tên thực tế của mình
      if (usernameInput && usernameInput.value !== cleanName) {
        usernameInput.value = cleanName;
      }

      // 1. Kiểm tra nếu bỏ trống tên
      if (!cleanName || cleanName.length === 0) {
        this.showLoginError('Vui lòng nhập tên người chơi!');
        return;
      }

      this.clearLoginError();

      const socket = (window as any).socket;
      if (socket) {
        // Gửi yêu cầu đăng nhập và xử lý callback phản hồi từ server
        socket.emit('login', { username: cleanName, name: cleanName, sticker: this.selectedSticker }, (res: any) => {
          if (res && !res.success) {
            this.showLoginError(res.error || 'Tên này đã có người sử dụng, vui lòng chọn tên khác!');
          } else if (res && res.success) {
            try {
              localStorage.setItem('tank_username', res.name || cleanName);
              localStorage.setItem('player_name', res.name || cleanName);
            } catch (err) {}
            this.setPlayerName(res.name || cleanName, this.selectedSticker);
            this.showScreen('screen-menu');
            this.callbacks.onLogin?.(res.name || cleanName, this.selectedSticker);
          }
        });
      } else {
        // Offline fallback
        try {
          localStorage.setItem('tank_username', cleanName);
          localStorage.setItem('player_name', cleanName);
        } catch (err) {}
        this.setPlayerName(cleanName, this.selectedSticker);
        this.showScreen('screen-menu');
        this.callbacks.onLogin?.(cleanName, this.selectedSticker);
      }
    };

    // Form submits & button clicks
    const btnLogin = document.getElementById('btn-login') || document.getElementById('btn-login-submit');
    if (btnLogin) {
      btnLogin.onclick = (e) => performLogin(e);
      btnLogin.addEventListener('click', (e) => performLogin(e));
    }

    const formLogin = document.getElementById('form-login');
    if (formLogin) {
      formLogin.onsubmit = (e) => performLogin(e);
      formLogin.addEventListener('submit', (e) => performLogin(e));
    }

    document.getElementById('btn-change-name')?.addEventListener('click', () => {
      this.showScreen('screen-login');
    });

    // Create Room controls logic (Bot count disable / enable)
    const selectMode = document.getElementById('select-game-mode') as HTMLSelectElement;
    const selectBotCount = document.getElementById('select-bot-count') as HTMLSelectElement;
    const selectBotDifficulty = document.getElementById('select-bot-difficulty') as HTMLSelectElement;

    const updateBotControls = () => {
      if (!selectMode || !selectBotCount || !selectBotDifficulty) return;
      const isTeam = selectMode.value === 'teambattle';
      if (isTeam) {
        selectBotCount.value = '0';
        selectBotCount.disabled = true;
        selectBotDifficulty.value = 'easy';
        selectBotDifficulty.disabled = true;
      } else {
        selectBotCount.disabled = false;
        if (selectBotCount.value === '0') {
          selectBotDifficulty.disabled = true;
        } else {
          selectBotDifficulty.disabled = false;
        }
      }
    };

    const updateCreateRoomModeUI = () => {
      const containerBoMode = document.getElementById('container-bo-mode');
      const containerBotOptions = document.getElementById('container-bot-options');
      const selectBoMode = document.getElementById('select-bo-mode') as HTMLSelectElement;

      if (!selectMode) return;
      if (selectMode.value === 'teambattle') {
        containerBoMode?.classList.remove('hidden');
        containerBotOptions?.classList.add('hidden');
      } else {
        containerBoMode?.classList.add('hidden');
        containerBotOptions?.classList.remove('hidden');
        if (selectBoMode) selectBoMode.value = 'BO1';
      }

      if (selectBotCount && selectBotDifficulty) {
        if (selectBotCount.value === '0') {
          selectBotDifficulty.disabled = true;
        } else {
          selectBotDifficulty.disabled = false;
        }
      }
    };

    selectMode?.addEventListener('change', updateCreateRoomModeUI);
    selectBotCount?.addEventListener('change', updateCreateRoomModeUI);
    updateCreateRoomModeUI();

    document.getElementById('form-create-room')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const roomNameInput = document.getElementById('input-room-name') as HTMLInputElement;
      const roomName = roomNameInput ? roomNameInput.value.trim() : '';

      if (!roomName) {
        alert('Vui lòng nhập tên phòng!');
        return;
      }

      const password = (document.getElementById('input-room-password') as HTMLInputElement).value;
      const mode = selectMode ? selectMode.value : 'deathmatch';
      const maxPlayers = 10;
      const durationMinutes = parseInt((document.getElementById('select-match-duration') as HTMLSelectElement).value, 10);
      const matchDuration = (!isNaN(durationMinutes) && durationMinutes > 0) ? durationMinutes * 60 : 180;
      const selectBoMode = document.getElementById('select-bo-mode') as HTMLSelectElement;
      const boMode = selectBoMode?.value || 'BO1';

      this.callbacks.onCreateRoom({
        roomName,
        password,
        mode,
        maxPlayers,
        matchDuration,
        botCount: 0,
        botDifficulty: 'smart',
        boMode,
        sticker: this.selectedSticker,
      });
      this.hideAllModals();
    });

    // In-Game Chat form binding
    const gameChatInput = document.getElementById('input-game-chat') as HTMLInputElement;
    if (gameChatInput) {
      gameChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          gameChatInput.blur();
        } else if (e.key === 'Enter' && !gameChatInput.value.trim()) {
          e.preventDefault();
          gameChatInput.blur();
        }
      });
    }

    document.getElementById('form-game-chat')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('input-game-chat') as HTMLInputElement;
      if (input && input.value.trim()) {
        this.callbacks.onSendChat?.(input.value.trim());
        input.value = '';
      }
      if (input) input.blur();
    });

    // Lobby Chat form binding
    const lobbyChatInput = document.getElementById('input-lobby-chat') as HTMLInputElement;
    if (lobbyChatInput) {
      lobbyChatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          lobbyChatInput.blur();
        }
      });
    }

    document.getElementById('form-lobby-chat')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('input-lobby-chat') as HTMLInputElement;
      if (input && input.value.trim()) {
        this.callbacks.onSendChat?.(input.value.trim());
        input.value = '';
      }
      if (input) input.blur();
    });

    // Toggle In-Game Chat Box
    document.getElementById('btn-toggle-game-chat')?.addEventListener('click', () => {
      const chatContainer = document.getElementById('game-chat-log-container');
      const toggleBtn = document.getElementById('btn-toggle-game-chat');
      if (chatContainer) {
        const isHidden = chatContainer.classList.toggle('hidden');
        if (toggleBtn) {
          toggleBtn.textContent = isHidden ? 'Mở 💬' : 'Thu 💬';
        }
      }
    });

    // Join Password Form submit
    document.getElementById('form-join-password')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLElement;
      const roomId = form.dataset.roomId;
      const pwdInput = document.getElementById('input-join-password') as HTMLInputElement;
      const password = pwdInput ? pwdInput.value : '';
      if (roomId) {
        this.callbacks.onJoinRoomId(roomId, this.selectedSticker, password);
        this.hideAllModals();
        if (pwdInput) pwdInput.value = '';
      }
    });

    // In-game Start Match button (Host only)
    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      this.callbacks.onStartMatch?.();
    });

    // In-game leave button
    document.getElementById('btn-leave-game')?.addEventListener('click', () => {
      this.callbacks.onLeaveGame();
    });

    // Window global callback bindings
    (window as any).handleAddBot = (team: string = 'red') => {
      handleBotAction(team, 'add', this.callbacks.onAddBotToTeam);
    };
    (window as any).handleRemoveBot = (team: string = 'red') => {
      handleBotAction(team, 'remove', this.callbacks.onRemoveBotFromTeam);
    };
    (window as any).handleBotAction = (team: string, action: 'add' | 'remove') => {
      handleBotAction(team, action, action === 'add' ? this.callbacks.onAddBotToTeam : this.callbacks.onRemoveBotFromTeam);
    };
    (window as any).changeTeam = (team: 'red' | 'blue') => {
      this.callbacks.onSwitchTeam?.(team);
    };
    (window as any).switchTeam = (team: 'red' | 'blue') => {
      this.callbacks.onSwitchTeam?.(team);
    };

    // Document-wide event delegation for bot buttons & emote buttons (SINGLE HANDLER WITH DEBOUNCE)
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      // Handle Emote Click (Event Delegation for in-game & lobby emotes)
      const btnEmote = target.closest('.btn-game-emote, .btn-lobby-emote, .lobby-emote-btn, .game-emote-btn');
      if (btnEmote) {
        e.preventDefault();
        e.stopPropagation();
        const emote = btnEmote.getAttribute('data-emote');
        if (emote) {
          this.callbacks.onSendEmote?.(emote);
        }
        return;
      }

      const btnAdd = target.closest('#btn-add-bot-red, #btn-add-bot-blue, #btn-add-bot-dm, [data-bot-add]');
      const btnRemove = target.closest('#btn-remove-bot-red, #btn-remove-bot-blue, #btn-remove-bot-dm, [data-bot-remove]');

      if (btnAdd) {
        e.preventDefault();
        e.stopPropagation();
        const attr = btnAdd.getAttribute('data-bot-add');
        let team = 'red';
        if (attr) {
          team = attr;
        } else if (btnAdd.id.includes('blue')) {
          team = 'blue';
        } else if (btnAdd.id.includes('dm') || btnAdd.id.includes('deathmatch')) {
          team = 'deathmatch';
        }
        handleBotAction(team, 'add', this.callbacks.onAddBotToTeam);
        return;
      }

      if (btnRemove) {
        e.preventDefault();
        e.stopPropagation();
        const attr = btnRemove.getAttribute('data-bot-remove');
        let team = 'red';
        if (attr) {
          team = attr;
        } else if (btnRemove.id.includes('blue')) {
          team = 'blue';
        } else if (btnRemove.id.includes('dm') || btnRemove.id.includes('deathmatch')) {
          team = 'deathmatch';
        }
        handleBotAction(team, 'remove', this.callbacks.onRemoveBotFromTeam);
        return;
      }
    });

    // Team selection in waiting room
    document.getElementById('btn-select-team-red')?.addEventListener('click', () => {
      this.callbacks.onSwitchTeam?.('red');
    });
    document.getElementById('btn-select-team-blue')?.addEventListener('click', () => {
      this.callbacks.onSwitchTeam?.('blue');
    });

    // Settings sliders & dropdowns & toggles
    document.getElementById('slider-volume')?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.callbacks.onVolumeChange(val);
    });

    const selectBotDiff = document.getElementById('select-setting-bot-difficulty') as HTMLSelectElement;
    if (selectBotDiff) {
      const savedDiff = localStorage.getItem('bot_difficulty') || 'smart';
      selectBotDiff.value = savedDiff;
      selectBotDiff.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value;
        localStorage.setItem('bot_difficulty', val);
      });
    }

    const toggleTouchControls = document.getElementById('toggle-touch-controls') as HTMLInputElement;
    if (toggleTouchControls) {
      if (this.callbacks.getTouchUIEnabled) {
        toggleTouchControls.checked = this.callbacks.getTouchUIEnabled();
      }
      toggleTouchControls.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        this.callbacks.onToggleTouchControls?.(checked);
      });
    }

    // Move waiting banner modal to document.body if needed so it stays absolute viewport centered
    const waitingBanner = document.getElementById('hud-waiting-banner');
    if (waitingBanner && waitingBanner.parentElement !== document.body) {
      document.body.appendChild(waitingBanner);
    }

    // Scoreboard header click handler initialized ONCE
    const scoreboardHeader = document.getElementById('scoreboard-header');
    const scoreboardList = document.getElementById('scoreboard-players-list');
    const btnToggleScoreboard = document.getElementById('btn-toggle-scoreboard');

    if (scoreboardHeader && scoreboardList && btnToggleScoreboard) {
      scoreboardHeader.onclick = (e) => {
        e.stopPropagation();
        const isHidden = scoreboardList.classList.toggle('hidden');
        this.isScoreboardCollapsed = isHidden;
        btnToggleScoreboard.textContent = isHidden ? 'Mở 🔽' : 'Thu 🔼';
      };
    }

    this.initFullscreenHandler();
    this.initMobileTouchControls();
    this.initLandscapeCheck();
    this.initTouchMovePrevent();

  }

  public triggerAutoFullscreen() {
    // Auto fullscreen disabled per user settings. Controlled manually via Fullscreen button.
  }

  private initTouchMovePrevent() {
    document.addEventListener('touchmove', function(e: TouchEvent) {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.closest('.scrollable-area')) {
        e.preventDefault();
      }
    }, { passive: false });
  }

  public isMobileDevice(): boolean {
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    return isMobileUA && hasTouch;
  }

  public isMobileOrTouchDevice(): boolean {
    return this.isMobileDevice();
  }

  private initMobileTouchControls() {
    const joystickBase = document.getElementById('mobile-joystick-base');
    const joystickKnob = document.getElementById('mobile-joystick-knob');
    const btnFire = document.getElementById('btn-mobile-fire');

    if (!joystickBase || !joystickKnob || !btnFire) return;

    let joystickActive = false;
    let touchId: number | null = null;

    const updateJoystickPosition = (clientX: number, clientY: number) => {
      const rect = joystickBase.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const maxRadius = rect.width / 2;

      const dx = clientX - centerX;
      const dy = clientY - centerY;
      const dist = Math.hypot(dx, dy);

      const maxKnobRadius = maxRadius - 10;
      const clampedDist = Math.min(dist, maxKnobRadius);
      const targetAngle = Math.atan2(dy, dx);

      const knobX = Math.cos(targetAngle) * clampedDist;
      const knobY = Math.sin(targetAngle) * clampedDist;

      joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      if (dist < 5) {
        this.callbacks.onJoystickInput?.(true, targetAngle, 0);
      } else {
        const intensity = Math.min(1, dist / maxKnobRadius);
        this.callbacks.onJoystickInput?.(true, targetAngle, intensity);
      }
    };

    const resetJoystick = () => {
      joystickActive = false;
      touchId = null;
      joystickKnob.style.transform = 'translate(0px, 0px)';
      this.callbacks.onJoystickInput?.(false, 0, 0);
    };

    joystickBase.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      if (!joystickActive && e.changedTouches.length > 0) {
        const t = e.changedTouches[0];
        touchId = t.identifier;
        joystickActive = true;
        updateJoystickPosition(t.clientX, t.clientY);
      }
    }, { passive: false });

    window.addEventListener('touchmove', (e: TouchEvent) => {
      if (!joystickActive || touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === touchId) {
          e.preventDefault();
          updateJoystickPosition(t.clientX, t.clientY);
          break;
        }
      }
    }, { passive: false });

    const handleTouchEnd = (e: TouchEvent) => {
      if (!joystickActive || touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          resetJoystick();
          break;
        }
      }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // Fire Button Touch Event Mapping
    const setFireState = (active: boolean) => {
      this.callbacks.onVirtualFire?.(active);
      if (active) {
        btnFire.classList.add('active');
      } else {
        btnFire.classList.remove('active');
      }
    };

    btnFire.addEventListener('touchstart', (e: TouchEvent) => {
      e.preventDefault();
      setFireState(true);
    }, { passive: false });

    btnFire.addEventListener('touchend', (e: TouchEvent) => {
      e.preventDefault();
      setFireState(false);
    }, { passive: false });

    btnFire.addEventListener('touchcancel', (e: TouchEvent) => {
      e.preventDefault();
      setFireState(false);
    }, { passive: false });
  }

  private initLandscapeCheck() {
    const warningOverlay = document.getElementById('overlay-landscape-warning');
    if (warningOverlay) {
      warningOverlay.classList.add('hidden');
    }
  }

  private isOfflineMode = false;

  private initFullscreenHandler() {
    const btnFullscreenModal = document.getElementById('btn-fullscreen');
    const btnToggle = document.getElementById('btn-fullscreen-toggle');
    const btnLandscape = document.getElementById('btn-landscape-fullscreen');

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          (document.documentElement as any).webkitRequestFullscreen();
        }

        // Ép xoay ngang màn hình (nếu trình duyệt điện thoại hỗ trợ API)
        if (screen.orientation && (screen.orientation as any).lock) {
          (screen.orientation as any).lock('landscape').catch(() => {
            // Bỏ qua nếu trình duyệt không cấp quyền lock orientation
          });
        }
      } else {
        // Nếu đang Fullscreen thì thoát Fullscreen
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        }
        if (screen.orientation && screen.orientation.unlock) {
          try {
            screen.orientation.unlock();
          } catch (e) {}
        }
      }
    };

    btnFullscreenModal?.addEventListener('click', toggleFullscreen);
    btnToggle?.addEventListener('click', toggleFullscreen);
    btnLandscape?.addEventListener('click', toggleFullscreen);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const isFullscreen = !!document.fullscreenElement;
      if (btnFullscreenModal) {
        btnFullscreenModal.textContent = isFullscreen
          ? '🖥️ THOÁT TOÀN MÀN HÌNH'
          : '🖥️ MỞ RỘNG TOÀN MÀN HÌNH (FULLSCREEN)';
      }
      if (btnToggle) {
        btnToggle.innerHTML = isFullscreen
          ? `<span class="text-sm">⛶</span><span class="hidden sm:inline"> THOÁT TOÀN MÀN HÌNH</span>`
          : `<span class="text-sm">⛶</span><span class="hidden sm:inline"> TOÀN MÀN HÌNH</span>`;
      }
    });
  }

  showModal(modalId: string) {
    this.hideAllModals();
    let modal = document.getElementById(modalId);
    if (!modal && modalId.startsWith('modal-')) {
      modal = document.getElementById(modalId.replace('modal-', '') + '-modal');
    } else if (!modal && modalId.endsWith('-modal')) {
      modal = document.getElementById('modal-' + modalId.replace('-modal', ''));
    }
    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('active', 'show');
      modal.style.setProperty('display', 'flex', 'important');

      if (modalId === 'modal-settings' || modalId === 'settings') {
        const toggleTouch = document.getElementById('toggle-touch-controls') as HTMLInputElement;
        if (toggleTouch && this.callbacks.getTouchUIEnabled) {
          toggleTouch.checked = this.callbacks.getTouchUIEnabled();
        }
      }
    }
  }

  hideModal(modalId: string) {
    let modal = document.getElementById(modalId);
    if (!modal && modalId.startsWith('modal-')) {
      modal = document.getElementById(modalId.replace('modal-', '') + '-modal');
    } else if (!modal && modalId.endsWith('-modal')) {
      modal = document.getElementById('modal-' + modalId.replace('-modal', ''));
    }
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('active', 'show');
      modal.style.setProperty('display', 'none', 'important');
    }
  }

  hideAllModals() {
    document.querySelectorAll('.modal-overlay, .modal').forEach((m) => {
      m.classList.add('hidden');
      m.classList.remove('active', 'show');
      (m as HTMLElement).style.setProperty('display', 'none', 'important');
    });
  }

  showScreen(screenId: 'screen-login' | 'screen-menu' | 'screen-lobby' | 'screen-game' | string) {
    this.hideAllModals();
    const isMobile = this.isMobileDevice();

    const targetScreen = (screenId === 'screen-lobby' || screenId === 'screen-menu') ? 'screen-menu' : screenId;
    const screens = ['screen-login', 'screen-menu', 'screen-lobby', 'screen-game'];

    screens.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        const shouldShow = (id === targetScreen) || (targetScreen === 'screen-menu' && id === 'screen-lobby');
        if (shouldShow) {
          el.classList.remove('hidden');
          el.style.setProperty('display', 'flex', 'important');
        } else {
          el.classList.add('hidden');
          el.style.setProperty('display', 'none', 'important');
        }
      }
    });

    // Hide waiting banner when on login or main menu
    if (screenId !== 'screen-game') {
      const banner = document.getElementById('hud-waiting-banner');
      if (banner) banner.classList.add('hidden');
    }

    if (screenId === 'screen-game') {
      this.callbacks.onResizeRequested?.();
      window.dispatchEvent(new Event('resize'));
    }

    if (isMobile) {
      document.body.classList.add('is-mobile-device');
    } else {
      document.body.classList.remove('is-mobile-device');
    }

    const isInGame = (screenId === 'screen-game');
    this.callbacks.onSetInGame?.(isInGame);
  }

  setPlayerName(name: string, sticker?: string) {
    const displayEl = document.getElementById('display-user-name');
    if (displayEl) displayEl.textContent = name;
    const loginInput = (document.getElementById('input-username') || document.getElementById('input-login-name')) as HTMLInputElement;
    if (loginInput) loginInput.value = name;

    if (sticker) {
      this.selectedSticker = sticker;
      const stickerEl = document.getElementById('display-user-sticker');
      if (stickerEl) stickerEl.textContent = sticker;
    }
  }

  setHostStatus(isHost: boolean) {
    const hostBadge = document.getElementById('host-badge');
    if (hostBadge) {
      hostBadge.classList.toggle('hidden', !isHost);
      hostBadge.classList.toggle('flex', isHost);
    }

    const startBtn = document.getElementById('btn-start-match');
    const nonHostMsg = document.getElementById('waiting-nonhost-msg');

    if (startBtn) {
      if (isHost) {
        startBtn.classList.remove('hidden');
        startBtn.style.display = '';
      } else {
        startBtn.classList.add('hidden');
        startBtn.style.display = 'none';
      }
    }

    if (nonHostMsg) {
      if (isHost) {
        nonHostMsg.classList.add('hidden');
        nonHostMsg.style.display = 'none';
      } else {
        nonHostMsg.classList.remove('hidden');
        nonHostMsg.style.display = '';
      }
    }
  }

  updateHUD(players: any[], localPlayerId: string, hostId?: string, roomConfig?: any) {
    const scoreboardEl = document.getElementById('hud-scoreboard');
    const titleEl = document.getElementById('scoreboard-title');
    const listEl = document.getElementById('scoreboard-players-list');
    const btnToggle = document.getElementById('btn-toggle-scoreboard');
    if (!scoreboardEl || !listEl) return;

    if (this.isScoreboardCollapsed) {
      listEl.classList.add('hidden');
    } else {
      listEl.classList.remove('hidden');
    }
    if (btnToggle) {
      btnToggle.textContent = this.isScoreboardCollapsed ? 'Mở 🔽' : 'Thu 🔼';
    }

    const mode = roomConfig?.mode;
    const isTeamBattle = mode === 'teambattle';

    if (isTeamBattle) {
      scoreboardEl.className = 'fixed top-12 md:top-[60px] right-2 md:right-4 bg-slate-900/95 border border-slate-700/80 p-2 md:p-3.5 rounded-xl md:rounded-2xl w-44 sm:w-60 md:w-80 shadow-xl pointer-events-auto z-[100] opacity-100 backdrop-blur-md';
      if (titleEl) {
        titleEl.textContent = '⚔️ THÀNH VIÊN';
      }

      const redPlayers = players.filter((p) => p.team === 'red');
      const bluePlayers = players.filter((p) => p.team === 'blue');

      const renderPlayerRow = (p: any) => {
        const isMe = p.id === localPlayerId;
        const isHost = p.id === hostId;
        const isDead = p.hp !== undefined && p.hp <= 0;
        const stickerIcon = p.sticker || '🐥';
        const hostLabel = isHost ? '<span class="text-[8px] md:text-[9px] bg-amber-500 text-slate-950 px-1 py-0.2 rounded font-black border border-amber-300">👑</span>' : '';

        const cleanName = (p.name || 'Player').replace(/^🤖\s*/, '');
        const displayName = (p.isBot ? '🤖 ' : '') + cleanName;

        let containerClass = 'flex items-center justify-between text-[10px] md:text-xs my-0.5 md:my-1 px-1.5 md:px-2 py-0.5 md:py-1.5 rounded-lg md:rounded-xl transition';
        let containerStyle = '';

        if (isDead) {
          containerStyle = 'background: transparent !important; border: 1px solid #475569; opacity: 0.65;';
          containerClass += ' text-slate-400 font-medium';
        } else if (isMe) {
          const teamBorderColor = p.team === 'red' ? '#ef4444' : '#06b6d4';
          containerStyle = `background: transparent !important; border: 2px solid ${teamBorderColor};`;
          containerClass += ' text-white font-black';
        } else {
          containerStyle = 'background: transparent !important; border: 1px solid rgba(255, 255, 255, 0.1);';
          containerClass += ' text-white font-bold';
        }

        const nameColorClass = isDead ? 'line-through text-slate-400 font-medium' : 'text-white font-black';

        const statusBadge = isDead 
          ? '<span class="text-[8px] md:text-[9px] text-rose-300 font-black ml-auto bg-rose-950/80 border border-rose-500 px-1 md:px-1.5 py-0.2 md:py-0.5 rounded shrink-0">☠️</span>' 
          : '';

        return `
          <div class="${containerClass}" style="${containerStyle}">
            <div class="flex items-center gap-1 md:gap-1.5 overflow-hidden pr-0.5 md:pr-1 min-w-0">
              <span class="text-xs md:text-sm shrink-0">${stickerIcon}</span>
              <span class="truncate ${nameColorClass}">${displayName}</span>
              ${hostLabel}
            </div>
            ${statusBadge ? `<div class="flex items-center gap-0.5 md:gap-1 shrink-0">${statusBadge}</div>` : ''}
          </div>
        `;
      };

      const redAliveCount = redPlayers.filter((p) => p.hp > 0).length;
      const blueAliveCount = bluePlayers.filter((p) => p.hp > 0).length;

      listEl.innerHTML = `
        <div id="scoreboard-body-container" class="grid grid-cols-2 gap-1 md:gap-2 text-[10px] md:text-xs">
          <div>
            <div class="font-black text-white mb-1 md:mb-1.5 flex items-center justify-between bg-rose-900 px-1.5 md:px-2.5 py-1 md:py-1.5 rounded-lg md:rounded-xl border border-rose-400 shadow-md text-[9px] md:text-xs">
              <span>🔴<span class="hidden md:inline"> ĐỘI ĐỎ</span></span>
              <span class="text-[8px] md:text-[10px] text-rose-100 font-mono bg-rose-950 px-1 md:px-1.5 py-0.5 rounded border border-rose-400/60 font-bold">${redAliveCount}/${redPlayers.length}</span>
            </div>
            <div class="space-y-0.5 md:space-y-1">
              ${redPlayers.length > 0 ? redPlayers.map(renderPlayerRow).join('') : '<div class="text-[9px] md:text-[11px] text-slate-300 italic py-1 md:py-2 text-center bg-slate-950 rounded-lg md:rounded-xl border border-slate-800">Trống</div>'}
            </div>
          </div>
          <div>
            <div class="font-black text-white mb-1 md:mb-1.5 flex items-center justify-between bg-blue-900 px-1.5 md:px-2.5 py-1 md:py-1.5 rounded-lg md:rounded-xl border border-blue-400 shadow-md text-[9px] md:text-xs">
              <span>🔵<span class="hidden md:inline"> ĐỘI XANH</span></span>
              <span class="text-[8px] md:text-[10px] text-blue-100 font-mono bg-blue-950 px-1 md:px-1.5 py-0.5 rounded border border-blue-400/60 font-bold">${blueAliveCount}/${bluePlayers.length}</span>
            </div>
            <div class="space-y-0.5 md:space-y-1">
              ${bluePlayers.length > 0 ? bluePlayers.map(renderPlayerRow).join('') : '<div class="text-[9px] md:text-[11px] text-slate-300 italic py-1 md:py-2 text-center bg-slate-950 rounded-lg md:rounded-xl border border-slate-800">Trống</div>'}
            </div>
          </div>
        </div>
      `;

      return;
    }

    scoreboardEl.className = 'fixed top-12 md:top-[60px] right-2 md:right-4 bg-slate-900/95 border border-slate-700/80 p-2 md:p-3 rounded-xl md:rounded-2xl w-44 sm:w-56 md:w-64 shadow-xl pointer-events-auto z-[100] opacity-100 backdrop-blur-md';
    if (titleEl) {
      titleEl.textContent = '🏆 BẢNG XẾP HẠNG';
    }

    // Sort players by Score = (Kills * 100) - (Deaths * 50) descending
    const sorted = [...players].sort((a, b) => {
      const scoreA = Math.max(0, (a.score !== undefined ? a.score : (a.kills || 0) * 100 - (a.deaths || 0) * 50));
      const scoreB = Math.max(0, (b.score !== undefined ? b.score : (b.kills || 0) * 100 - (b.deaths || 0) * 50));
      if (scoreB !== scoreA) return scoreB - scoreA;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return (a.deaths || 0) - (b.deaths || 0);
    });

    let html = '';
    if (sorted.length === 0) {
      html = '<div class="text-[9px] md:text-[11px] text-slate-400 italic py-2 text-center">Chưa có người chơi</div>';
    } else {
      sorted.forEach((p) => {
        const isMe = p.id === localPlayerId;
        const isHost = p.id === hostId;
        const colorStyle = `color: ${p.color || '#f472b6'};`;
        const stickerIcon = p.sticker || '🐥';
        const calcScore = Math.max(0, p.score !== undefined ? p.score : (p.kills || 0) * 100 - (p.deaths || 0) * 50);

        const cleanName = (p.name || 'Player').replace(/^🤖\s*/, '');
        const displayName = (p.isBot ? '🤖 ' : '') + cleanName;

        const hostLabel = isHost ? '<span class="text-[8px] md:text-[9px] bg-amber-500/20 text-amber-300 border border-amber-400/40 px-1 py-0.2 rounded font-black ml-0.5 md:ml-1">👑</span>' : '';

        const containerStyle = isMe
          ? 'border: 2px solid #facc15; background: transparent !important;'
          : 'border: 1px solid rgba(255, 255, 255, 0.1); background: transparent !important;';

        html += `
          <div class="flex items-center justify-between text-[10px] md:text-xs my-0.5 md:my-1 px-1.5 md:px-2 py-0.5 md:py-1.5 rounded-lg md:rounded-xl ${isMe ? 'font-black text-white' : 'font-bold text-slate-200'}" style="${containerStyle}">
            <div class="flex items-center gap-1 overflow-hidden">
              <span class="text-xs md:text-sm">${stickerIcon}</span>
              <span class="truncate max-w-[65px] md:max-w-[85px]" style="${colorStyle}">${displayName}</span>
              ${hostLabel}
            </div>
            <div class="flex items-center gap-0.5 md:gap-1 font-mono text-[9px] md:text-[11px]">
              <span class="text-pink-400 font-black">${calcScore}đ</span>
              <span class="text-amber-300 font-bold">${p.kills}K</span>
              <span class="text-slate-400">${p.deaths}D</span>
            </div>
          </div>
        `;
      });
    }

    listEl.innerHTML = html;
  }

  resetRoomUI(mode?: string, roomName?: string) {
    if (roomName) {
      this.setRoomName(roomName);
    }
    
    // Clear / Hide series score if not teambattle
    const seriesEl = document.getElementById('hud-series-score');
    if (seriesEl) {
      if (mode === 'teambattle') {
        seriesEl.classList.remove('hidden');
        seriesEl.style.display = '';
      } else {
        seriesEl.innerHTML = '';
        seriesEl.classList.add('hidden');
        seriesEl.style.display = 'none';
      }
    }

    // Reset Scoreboard title & clear player rows
    const scoreboardEl = document.getElementById('hud-scoreboard');
    const titleEl = document.getElementById('scoreboard-title');
    const listEl = document.getElementById('scoreboard-players-list');
    if (scoreboardEl) {
      if (mode === 'teambattle') {
        scoreboardEl.className = 'fixed top-12 md:top-[60px] right-2 md:right-4 bg-slate-900/95 border border-slate-700/80 p-2 md:p-3.5 rounded-xl md:rounded-2xl w-44 sm:w-60 md:w-80 shadow-xl pointer-events-auto z-[100] opacity-100 backdrop-blur-md';
        if (titleEl) titleEl.textContent = '⚔️ THÀNH VIÊN';
      } else {
        scoreboardEl.className = 'fixed top-12 md:top-[60px] right-2 md:right-4 bg-slate-900/95 border border-slate-700/80 p-2 md:p-3 rounded-xl md:rounded-2xl w-44 sm:w-56 md:w-64 shadow-xl pointer-events-auto z-[100] opacity-100 backdrop-blur-md';
        if (titleEl) titleEl.textContent = '🏆 BẢNG XẾP HẠNG';
      }
    }
    if (listEl) {
      listEl.innerHTML = '';
    }

    this.clearGameChatLog();
  }

  updateMetrics(fps: number, ping: number) {
    this.fpsCounter = fps;
    this.pingCounter = ping;
    const fpsEl = document.getElementById('hud-fps');
    const pingEl = document.getElementById('hud-ping');
    if (fpsEl) fpsEl.textContent = `FPS: ${fps}`;
    if (pingEl) {
      pingEl.textContent = `📶 ${ping}ms`;
    }
  }

  setOfflineModeUI(isOffline: boolean) {
    this.isOfflineMode = isOffline;
    const chatBox = document.getElementById('game-chat-box');
    const seriesEl = document.getElementById('hud-series-score');

    if (isOffline) {
      if (chatBox) {
        chatBox.classList.add('hidden');
        chatBox.style.display = 'none';
      }
      if (seriesEl) {
        seriesEl.classList.add('hidden');
        seriesEl.style.display = 'none';
      }
    } else {
      if (chatBox) {
        chatBox.classList.remove('hidden');
        chatBox.style.display = '';
      }
    }
  }

  updateSeriesScore(boMode: string, seriesScore: { red: number; blue: number }, winsNeeded: number, currentRound: number, gameMode?: string, isOffline?: boolean) {
    const seriesEl = document.getElementById('hud-series-score');
    if (!seriesEl) return;

    // Ẩn hoàn toàn thông tin tỉ số khi Offline hoặc không phải Đấu Đội (Team Battle)
    if (isOffline || !gameMode || gameMode !== 'teambattle') {
      seriesEl.innerHTML = '';
      seriesEl.classList.add('hidden');
      seriesEl.style.display = 'none';
      return;
    }

    seriesEl.classList.remove('hidden');
    seriesEl.style.display = '';
    const red = seriesScore?.red || 0;
    const blue = seriesScore?.blue || 0;

    let maxScore = winsNeeded || 1;
    if (!winsNeeded && boMode) {
      if (boMode === 'BO3' || boMode === '3') maxScore = 3;
      else if (boMode === 'BO5' || boMode === '5') maxScore = 5;
      else if (boMode === 'BO1' || boMode === '1') maxScore = 1;
      else {
        const parsed = parseInt(String(boMode).replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) maxScore = parsed;
      }
    }

    seriesEl.textContent = `🔴 ${red} - ${blue} 🔵 (Chạm ${maxScore})`;
  }

  clearGameChatLog() {
    const container = document.getElementById('game-chat-log');
    if (container) {
      container.innerHTML = '';
    }
  }

  appendChatMessage(data: { senderName: string; senderSticker?: string; senderColor?: string; message?: string; emoji?: string; emote?: string }, isGame: boolean = false) {
    const boxId = isGame ? 'game-chat-log' : 'lobby-chat-log';
    const container = document.getElementById(boxId);
    const text = data.message || data.emoji || data.emote;
    if (!container || !text || !text.trim()) return;

    const msgEl = document.createElement('div');
    msgEl.className = 'text-xs flex items-center gap-1.5 leading-snug py-0.5 border-b border-slate-800/40 last:border-none';

    const color = data.senderColor || '#38bdf8';
    const sticker = data.senderSticker || '🐥';

    msgEl.innerHTML = `
      <span class="text-sm shrink-0">${sticker}</span>
      <span class="font-bold shrink-0" style="color: ${color}">${data.senderName}:</span>
      <span class="text-slate-200 break-words font-medium">${text.trim()}</span>
    `;

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  hideMatchTimer() {
    const timerEl = document.getElementById('hud-match-timer');
    if (timerEl) {
      timerEl.classList.add('hidden');
      timerEl.style.display = 'none';
    }
  }

  showMatchTimer() {
    const timerEl = document.getElementById('hud-match-timer');
    if (timerEl) {
      timerEl.classList.remove('hidden');
      timerEl.style.display = '';
    }
  }

  updateMatchTimer(secondsRemaining: number) {
    const timerEl = document.getElementById('hud-match-timer');
    if (!timerEl) return;
    this.showMatchTimer();
    const mins = Math.floor(secondsRemaining / 60);
    const secs = secondsRemaining % 60;
    const formatted = `⏱️ ${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    timerEl.textContent = formatted;

    if (secondsRemaining <= 10 && secondsRemaining > 0) {
      // Chỉ đổi màu đỏ / nhấp nháy trên đồng hồ đếm ngược Header
      timerEl.className = 'text-rose-100 font-black border border-rose-500/80 bg-rose-950/80 px-3 py-1 rounded-lg text-xs shadow-lg timer-pulse-subtle';
    } else {
      timerEl.className = 'text-amber-300 font-black border border-amber-500/40 bg-amber-950/40 px-3 py-1 rounded-lg text-xs shadow-sm';
    }
  }

  setRoomName(name: string) {
    const nameEl = document.getElementById('hud-room-name');
    if (nameEl) {
      nameEl.textContent = name;
    }
  }

  updateWaitingRoomState(status: string, isHost: boolean, playerCount: number, maxPlayers: number, mode?: string, myTeam?: string) {
    const banner = document.getElementById('hud-waiting-banner');
    const statusText = document.getElementById('waiting-banner-status');
    const startBtn = document.getElementById('btn-start-match');
    const nonHostMsg = document.getElementById('waiting-nonhost-msg');
    const teamSelectContainer = document.getElementById('waiting-team-select');
    const btnTeamRed = document.getElementById('btn-select-team-red');
    const btnTeamBlue = document.getElementById('btn-select-team-blue');

    if (!banner) return;

    if (banner && banner.parentElement !== document.body) {
      document.body.appendChild(banner);
    }

    const gameScreen = document.getElementById('screen-game');
    const isGameScreenVisible = gameScreen && !gameScreen.classList.contains('hidden');

    // NẾU BẢNG VINH DANH (MVP MODAL) HOẶC THÔNG BÁO HẾT VÁN ĐANG HIỂN THỊ, TUYỆT ĐỐI KHÔNG HIỂN THỊ PHÒNG CHỜ ĐÈ LÊN!
    const mvpModal = document.getElementById('modal-mvp');
    const isMvpOpen = mvpModal && !mvpModal.classList.contains('hidden');
    const roundEndModal = document.getElementById('modal-round-end');
    const isRoundEndOpen = roundEndModal && !roundEndModal.classList.contains('hidden');

    if (status === 'waiting' && isGameScreenVisible && !isMvpOpen && !isRoundEndOpen) {
      banner.classList.remove('hidden');
      const countEl = document.getElementById('waiting-banner-count');
      if (countEl) {
        countEl.textContent = `(${playerCount}/${maxPlayers || 4})`;
      }
      if (statusText) {
        statusText.textContent = `👥 ${playerCount}/${maxPlayers || 4} Người chơi đã ở trong phòng chờ.`;
      }

      const hostBotRedCtrls = document.getElementById('host-bot-red-controls');
      const hostBotBlueCtrls = document.getElementById('host-bot-blue-controls');
      const hostBotDmCtrls = document.getElementById('host-bot-dm-controls');

      if (mode === 'teambattle' && teamSelectContainer) {
        teamSelectContainer.classList.remove('hidden');
        hostBotDmCtrls?.classList.add('hidden');
        if (isHost) {
          hostBotRedCtrls?.classList.remove('hidden');
          hostBotBlueCtrls?.classList.remove('hidden');
        } else {
          hostBotRedCtrls?.classList.add('hidden');
          hostBotBlueCtrls?.classList.add('hidden');
        }
        if (btnTeamRed) {
          btnTeamRed.textContent = '🔴 ĐỘI ĐỎ';
          if (myTeam === 'red') {
            btnTeamRed.className = 'btn-team-select bg-rose-600 text-white font-black py-2 px-3 rounded-xl w-full text-xs border-2 border-amber-300 shadow-md scale-105 transition cursor-pointer';
          } else {
            btnTeamRed.className = 'btn-team-select bg-rose-600 hover:bg-rose-500 text-white font-extrabold py-2 px-3 rounded-xl w-full text-xs shadow-md transition hover:scale-105 active:scale-95 cursor-pointer';
          }
        }
        if (btnTeamBlue) {
          btnTeamBlue.textContent = '🔵 ĐỘI XANH';
          if (myTeam === 'blue') {
            btnTeamBlue.className = 'btn-team-select bg-blue-600 text-white font-black py-2 px-3 rounded-xl w-full text-xs border-2 border-amber-300 shadow-md scale-105 transition cursor-pointer';
          } else {
            btnTeamBlue.className = 'btn-team-select bg-blue-600 hover:bg-blue-500 text-white font-extrabold py-2 px-3 rounded-xl w-full text-xs shadow-md transition hover:scale-105 active:scale-95 cursor-pointer';
          }
        }
      } else {
        if (teamSelectContainer) teamSelectContainer.classList.add('hidden');
        hostBotRedCtrls?.classList.add('hidden');
        hostBotBlueCtrls?.classList.add('hidden');

        if (isHost) {
          hostBotDmCtrls?.classList.remove('hidden');
        } else {
          hostBotDmCtrls?.classList.add('hidden');
        }
      }

      if (startBtn) {
        if (isHost) {
          startBtn.classList.remove('hidden');
          startBtn.style.display = '';
        } else {
          startBtn.classList.add('hidden');
          startBtn.style.display = 'none';
        }
      }
      if (nonHostMsg) {
        if (isHost) {
          nonHostMsg.classList.add('hidden');
          nonHostMsg.style.display = 'none';
        } else {
          nonHostMsg.classList.remove('hidden');
          nonHostMsg.style.display = '';
        }
      }
    } else {
      banner.classList.add('hidden');
    }
  }

  renderRoomList(roomList: any[]) {
    const container = document.getElementById('room-list-container');
    if (!container) return;

    if (roomList.length === 0) {
      container.innerHTML = `<div class="text-center text-slate-400 py-6 font-medium">Chưa có phòng nào. Hãy tạo phòng mới ngay!</div>`;
      return;
    }

    let html = '';
    roomList.forEach((r) => {
      const lockIcon = r.hasPassword ? '🔒 ' : '';
      const isPlaying = r.status === 'playing' || r.status === 'gameover';
      const statusBadge = isPlaying
        ? '<span class="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] px-2 py-0.5 rounded-full font-bold ml-2">[ĐANG TRONG TRẬN]</span>'
        : '<span class="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] px-2 py-0.5 rounded-full font-bold ml-2">[PHÒNG CHỜ]</span>';

      const buttonAttr = isPlaying ? 'disabled' : '';
      const buttonStyle = isPlaying
        ? 'bg-slate-700 text-slate-400 opacity-60 cursor-not-allowed'
        : 'bg-pink-500 hover:bg-pink-400 text-slate-950 font-extrabold hover:scale-105 active:scale-95';

      html += `
        <div class="flex items-center justify-between bg-slate-800/90 border border-slate-700 p-3.5 rounded-2xl ${isPlaying ? 'opacity-75' : 'hover:border-pink-400'} transition">
          <div>
            <div class="font-bold text-slate-100 flex items-center">${lockIcon}${r.name} ${statusBadge}</div>
            <div class="text-xs text-pink-400 uppercase font-bold mt-1">${r.mode.toUpperCase()} &bull; ${r.playerCount}/${r.maxPlayers} Người chơi</div>
          </div>
          <button ${buttonAttr} data-room-id="${r.id}" data-has-pwd="${r.hasPassword ? 'true' : 'false'}" data-room-name="${r.name}" class="btn-join-room-id ${buttonStyle} font-extrabold px-4 py-2 rounded-xl text-xs transition">
            ${isPlaying ? 'ĐANG ĐẤU' : 'VÀO PHÒNG'}
          </button>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach join click listeners
    container.querySelectorAll('.btn-join-room-id').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        if (target.hasAttribute('disabled')) return;

        const roomId = target.getAttribute('data-room-id');
        const hasPwd = target.getAttribute('data-has-pwd') === 'true';
        const roomName = target.getAttribute('data-room-name') || '';

        if (!roomId) return;

        if (hasPwd) {
          const promptNameEl = document.getElementById('password-prompt-room-name');
          if (promptNameEl) promptNameEl.textContent = `Phòng "${roomName}" yêu cầu mật khẩu để vào.`;
          
          const formJoinPassword = document.getElementById('form-join-password');
          if (formJoinPassword) {
            (formJoinPassword as any).dataset.roomId = roomId;
          }
          this.showModal('modal-room-password');
        } else {
          this.callbacks.onJoinRoomId(roomId, this.selectedSticker);
          this.hideAllModals();
        }
      });
    });
  }

  showRoundEndModal(_data: any) {
    // Hiển thị hoàn toàn trực tiếp trên Canvas, tuyệt đối không mở Modal HTML
    this.hideRoundEndModal();
  }

  hideRoundEndModal() {
    this.hideModal('modal-round-end');
  }

  showMVPModal(data: any): boolean {
    try {
      this.hideRoundEndModal();
      const banner = document.getElementById('hud-waiting-banner');
      if (banner) banner.classList.add('hidden');

      const canvasEl = document.getElementById('game-canvas');
      if (canvasEl) canvasEl.classList.remove('screen-shake-subtle');

      const titleEl = document.getElementById('mvp-room-title');
      if (titleEl && data?.roomName) titleEl.textContent = `BẢNG VINH DANH (${String(data.roomName).toUpperCase()})`;

      const container = document.getElementById('mvp-content-container');
      if (!container) {
        return false;
      }

      const isTeamBattle = data?.mode === 'teambattle' || !!data?.winningTeam || !!data?.winnerTeam;
      const winnerTeam = data?.winnerTeam || data?.winningTeam;
      const finalScore = data?.finalScore || data?.seriesScore;

      if (isTeamBattle) {
        if (winnerTeam === 'draw') {
          container.innerHTML = `
            <div class="bg-slate-900 border-2 border-amber-400 p-3 sm:p-4 rounded-2xl flex flex-col items-center gap-1.5 shadow-xl">
              <div class="text-3xl animate-bounce">🤝</div>
              <div class="text-sm sm:text-base font-black text-amber-300 uppercase">TRẬN ĐẤU HÒA!</div>
              <div class="text-[10px] sm:text-xs text-slate-300 font-bold">Cả hai đội có kết quả ngang bằng nhau.</div>
            </div>
          `;
        } else {
          const isRed = winnerTeam === 'red';
          const teamNameText = isRed ? 'ĐỘI ĐỎ' : 'ĐỘI XANH';
          const bgClass = isRed ? 'from-rose-950/95 to-rose-900/60 border-rose-500' : 'from-blue-950/95 to-blue-900/60 border-blue-500';
          const textClass = isRed ? 'text-rose-400' : 'text-blue-400';
          let winsNeeded = data?.winsNeeded;
          if (!winsNeeded && data?.boMode) {
            if (data.boMode === 'BO3' || data.boMode === '3') winsNeeded = 3;
            else if (data.boMode === 'BO5' || data.boMode === '5') winsNeeded = 5;
            else {
              const parsed = parseInt(String(data.boMode).replace(/\D/g, ''), 10);
              if (!isNaN(parsed) && parsed > 0) winsNeeded = parsed;
            }
          }
          if (!winsNeeded) winsNeeded = 1;
          const scoreText = finalScore ? `Tỉ số: 🔴 ${finalScore.red ?? 0} - ${finalScore.blue ?? 0} 🔵 (Chạm ${winsNeeded})` : '';

          // Format compact winning members list
          let memberNames: string[] = [];
          if (Array.isArray(data?.members) && data.members.length > 0) {
            memberNames = data.members.map((m: any) => {
              const prefix = m.isBot ? '🤖' : '👑';
              const cleanMName = (m.name || 'Người chơi').replace(/^🤖\s*/, '');
              return `${prefix} ${cleanMName}`;
            });
          } else if (Array.isArray(data?.winningMembers) && data.winningMembers.length > 0) {
            memberNames = data.winningMembers.map((m: any) => {
              const rawName = typeof m === 'string' ? m : (m.name || 'Người chơi');
              const cleanMName = rawName.replace(/^🤖\s*/, '');
              const prefix = (typeof m === 'object' && m?.isBot) || rawName.startsWith('Bot ') || rawName.startsWith('🤖') ? '🤖' : '👑';
              return `${prefix} ${cleanMName}`;
            });
          }

          const membersHtml = memberNames.length > 0
            ? memberNames.map((name) => `<span class="bg-slate-900/90 border border-slate-700 px-2 py-0.5 rounded-lg text-[11px] font-extrabold text-white shrink-0">${name}</span>`).join('')
            : '<span class="text-[11px] text-slate-400 font-bold">---</span>';

          const forfeitHtml = data?.forfeitMessage
            ? `<div class="bg-rose-500/20 text-rose-300 border border-rose-500/40 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase text-center w-full animate-pulse">${data.forfeitMessage}</div>`
            : '';

          container.innerHTML = `
            <div class="bg-gradient-to-b ${bgClass} border-2 p-3 sm:p-4 rounded-2xl flex flex-col items-center gap-2 shadow-2xl relative overflow-hidden">
              ${forfeitHtml}
              <div class="text-3xl animate-bounce">🏆</div>
              <div class="text-base sm:text-lg font-black ${textClass} uppercase tracking-tight text-center">
                ${teamNameText} CHIẾN THẮNG!
              </div>
              <div class="text-xs sm:text-sm font-black text-amber-300 bg-slate-950/80 px-3 py-1 rounded-full border border-amber-400/40 shadow-inner">
                ${scoreText}
              </div>
              <div class="w-full mt-1 bg-slate-950/70 p-2.5 rounded-xl border border-slate-700/80 text-center shadow-inner flex flex-col gap-1.5">
                <div class="text-[10px] font-black text-amber-300 uppercase tracking-wider">
                  Thành viên chiến thắng:
                </div>
                <div class="flex flex-wrap items-center justify-center gap-1.5 max-h-24 overflow-y-auto">
                  ${membersHtml}
                </div>
              </div>
            </div>
          `;
        }
      } else {
        const mvp = data?.mvp || { name: 'Vô địch', sticker: '🐥', score: 0, kills: 0, deaths: 0 };
        const scoreVal = mvp.score !== undefined ? mvp.score : Math.max(0, (mvp.kills || 0) * 100 - (mvp.deaths || 0) * 50);
        const cleanMvpName = (mvp.name || '---').replace(/^🤖\s*/, '');
        const displayMvpName = (mvp.isBot ? '🤖 ' : '') + cleanMvpName;

        container.innerHTML = `
          <div class="bg-gradient-to-b from-amber-950/70 to-amber-900/40 border-2 border-amber-400 p-3 sm:p-4 rounded-2xl flex flex-col items-center gap-1.5 shadow-xl relative overflow-hidden">
            <div class="text-3xl animate-bounce">🏆</div>
            <div class="text-[10px] font-black text-amber-300 uppercase tracking-widest bg-amber-500/20 px-3 py-0.5 rounded-full border border-amber-400/40">
              NHÀ VÔ ĐỊCH
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="text-xl">${mvp.sticker || '🐥'}</span>
              <div class="text-base sm:text-lg font-black text-white">${displayMvpName}</div>
            </div>
            <div class="flex items-center gap-2 text-xs font-mono font-black mt-1">
              <div class="bg-amber-500/30 text-amber-300 px-2.5 py-1 rounded-lg border border-amber-400/40">
                ${scoreVal} ĐIỂM
              </div>
              <div class="bg-emerald-950/80 text-emerald-400 px-2.5 py-1 rounded-lg border border-emerald-500/40">
                ${mvp.kills || 0} Kills
              </div>
              <div class="bg-rose-950/80 text-rose-400 px-2.5 py-1 rounded-lg border border-rose-500/40">
                ${mvp.deaths || 0} Deaths
              </div>
            </div>
          </div>
        `;
      }

      this.showModal('modal-mvp');
      return true;
    } catch (err) {
      console.error('[UI] Error in showMVPModal:', err);
      return false;
    }
  }

  public showLoginError(msg: string) {
    const errorEl = document.getElementById('login-error-msg');
    const textEl = document.getElementById('login-error-text');
    const inputEl = (document.getElementById('input-username') || document.getElementById('input-login-name')) as HTMLInputElement;

    if (errorEl && textEl) {
      textEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    if (inputEl) {
      inputEl.classList.remove('input-error-shake');
      void inputEl.offsetWidth; // Trigger reflow to restart animation
      inputEl.classList.add('input-error-shake');
      inputEl.focus();
    }
  }

  public clearLoginError() {
    const errorEl = document.getElementById('login-error-msg');
    const inputEl = (document.getElementById('input-username') || document.getElementById('input-login-name')) as HTMLInputElement;
    if (errorEl) {
      errorEl.classList.add('hidden');
    }
    if (inputEl) {
      inputEl.classList.remove('input-error-shake');
    }
  }
}
