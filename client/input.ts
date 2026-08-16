/**
 * Tank AZ Online - Cross-platform Input Manager
 * Centralizes Keyboard, Mouse, Mobile Touch (360° Joystick & Action Button), and Gamepad API.
 * Synthesizes all input sources for seamless cross-platform tank controls.
 */

export interface UnifiedInputState {
  forward: boolean;
  backward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  shoot: boolean;
  joystickActive: boolean;
  targetAngle: number;
  intensity: number;
  isGamepadActive: boolean;
  isTouchActive: boolean;
}

export interface InputManagerOptions {
  onInputChanged?: (state: UnifiedInputState) => void;
  onTouchUIVisibilityChanged?: (visible: boolean) => void;
  onGamepadStatusChanged?: (connected: boolean, id?: string) => void;
}

export class InputManager {
  private options: InputManagerOptions;

  // Keyboard & Mouse state
  private keys: Record<string, boolean> = {};
  private isMouseDown = false;

  // Mobile Touch Joystick state
  private touchJoystick = {
    active: false,
    touchId: null as number | null,
    targetAngle: 0,
    intensity: 0,
  };

  // Mobile Touch Fire state
  private touchFire = {
    active: false,
  };

  // Gamepad state
  private gamepadState = {
    connected: false,
    id: '',
    active: false,
    lastActiveTime: 0,
    forward: false,
    backward: false,
    turnLeft: false,
    turnRight: false,
    shoot: false,
    joystickActive: false,
    targetAngle: 0,
    intensity: 0,
  };

  // Configuration & Visibility State
  private isTouchDevice = false;
  private touchUIEnabled = false; // User setting
  private isCurrentlyInGame = false;

  // DOM Elements
  private touchControlsContainer: HTMLElement | null = null;
  private joystickBase: HTMLElement | null = null;
  private joystickKnob: HTMLElement | null = null;
  private btnFire: HTMLElement | null = null;

  constructor(options: InputManagerOptions = {}) {
    this.options = options;
    this.detectDeviceCapabilities();
    this.loadSettings();
  }

  /**
   * Detects if the current client device has touch screen capabilities.
   */
  private detectDeviceCapabilities() {
    this.isTouchDevice =
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  /**
   * Loads persisted touch UI settings or initializes sensible defaults based on device type.
   */
  private loadSettings() {
    const saved = localStorage.getItem('tank_touch_ui_enabled');
    if (saved !== null) {
      this.touchUIEnabled = saved === 'true';
    } else {
      // Default: ON for touch/mobile devices, OFF for desktop non-touch
      this.touchUIEnabled = this.isTouchDevice;
    }
  }

  public init() {
    this.bindKeyboardEvents();
    this.bindMouseEvents();
    this.bindGamepadEvents();
    this.bindTouchControls();
    this.updateTouchUIVisibility();
  }

  /**
   * Keyboard Events (WASD, Arrow Keys, Space, Enter to Chat)
   */
  private bindKeyboardEvents() {
    window.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true');

      // If user is currently typing in an input
      if (isTyping) {
        if (e.key === 'Escape') {
          (activeEl as HTMLElement).blur();
        }
        return;
      }

      // Quick Enter to open and focus Game Chat or Lobby Chat
      if (e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        const gameScreen = document.getElementById('screen-game');
        const gameChatInput = document.getElementById('input-game-chat') as HTMLInputElement;
        if (gameScreen && !gameScreen.classList.contains('hidden') && gameChatInput) {
          e.preventDefault();
          const chatContainer = document.getElementById('game-chat-log-container');
          const toggleBtn = document.getElementById('btn-toggle-game-chat');
          if (chatContainer && chatContainer.classList.contains('hidden')) {
            chatContainer.classList.remove('hidden');
            if (toggleBtn) toggleBtn.textContent = 'Thu 💬';
          }
          gameChatInput.focus();
          return;
        }

        const lobbyScreen = document.getElementById('screen-lobby');
        const lobbyChatInput = document.getElementById('input-lobby-chat') as HTMLInputElement;
        if (lobbyScreen && !lobbyScreen.classList.contains('hidden') && lobbyChatInput) {
          e.preventDefault();
          lobbyChatInput.focus();
          return;
        }
      }

      // Prevent scrolling when using arrow keys or space in game
      if (
        ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) &&
        this.isCurrentlyInGame
      ) {
        e.preventDefault();
      }

      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      this.keys[e.code] = false;
    });

    // Reset keys on window blur
    window.addEventListener('blur', () => {
      this.keys = {};
      this.isMouseDown = false;
    });
  }

  /**
   * Mouse Events (Left click fire)
   */
  private bindMouseEvents() {
    window.addEventListener('mousedown', (e) => {
      // Check if clicking inside interactive chat/modals/buttons
      const target = e.target as HTMLElement;
      if (target && target.closest('button, input, textarea, select, .modal-overlay, #game-chat-box, #hud-scoreboard')) {
        return;
      }

      if (e.button === 0) {
        this.isMouseDown = true;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseDown = false;
      }
    });
  }

  /**
   * Gamepad API connection listeners
   */
  private bindGamepadEvents() {
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      console.log('🎮 Tay cầm (Gamepad) đã kết nối:', e.gamepad.id);
      this.gamepadState.connected = true;
      this.gamepadState.id = e.gamepad.id;
      this.options.onGamepadStatusChanged?.(true, e.gamepad.id);
      this.updateTouchUIVisibility();
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      console.log('🎮 Tay cầm (Gamepad) đã ngắt kết nối:', e.gamepad.id);
      this.gamepadState.connected = false;
      this.gamepadState.active = false;
      this.gamepadState.id = '';
      this.options.onGamepadStatusChanged?.(false);
      this.updateTouchUIVisibility();
    });
  }

  /**
   * Mobile Touch (Virtual 360° Joystick & Action Fire Button)
   */
  private bindTouchControls() {
    this.touchControlsContainer = document.getElementById('mobile-touch-controls');
    this.joystickBase = document.getElementById('mobile-joystick-base');
    this.joystickKnob = document.getElementById('mobile-joystick-knob');
    this.btnFire = document.getElementById('btn-mobile-fire');

    if (!this.joystickBase || !this.joystickKnob || !this.btnFire) {
      return;
    }

    const updateJoystickPosition = (clientX: number, clientY: number) => {
      if (!this.joystickBase || !this.joystickKnob) return;
      const rect = this.joystickBase.getBoundingClientRect();
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

      this.joystickKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      if (dist < 6) {
        this.touchJoystick.active = true;
        this.touchJoystick.targetAngle = targetAngle;
        this.touchJoystick.intensity = 0;
      } else {
        this.touchJoystick.active = true;
        this.touchJoystick.targetAngle = targetAngle;
        this.touchJoystick.intensity = Math.min(1, dist / maxKnobRadius);
      }
    };

    const resetJoystick = () => {
      this.touchJoystick.active = false;
      this.touchJoystick.touchId = null;
      this.touchJoystick.intensity = 0;
      if (this.joystickKnob) {
        this.joystickKnob.style.transform = 'translate(0px, 0px)';
      }
    };

    // Joystick Touch Events
    this.joystickBase.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        if (!this.touchJoystick.active && e.changedTouches.length > 0) {
          const t = e.changedTouches[0];
          this.touchJoystick.touchId = t.identifier;
          this.touchJoystick.active = true;
          updateJoystickPosition(t.clientX, t.clientY);
        }
      },
      { passive: false }
    );

    window.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (!this.touchJoystick.active || this.touchJoystick.touchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.touchJoystick.touchId) {
            e.preventDefault();
            updateJoystickPosition(t.clientX, t.clientY);
            break;
          }
        }
      },
      { passive: false }
    );

    const handleTouchEnd = (e: TouchEvent) => {
      if (!this.touchJoystick.active || this.touchJoystick.touchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === this.touchJoystick.touchId) {
          resetJoystick();
          break;
        }
      }
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // Fire Button Touch Events
    const setTouchFireState = (active: boolean) => {
      this.touchFire.active = active;
      if (this.btnFire) {
        if (active) {
          this.btnFire.classList.add('scale-90', 'brightness-125', 'ring-4', 'ring-rose-400');
        } else {
          this.btnFire.classList.remove('scale-90', 'brightness-125', 'ring-4', 'ring-rose-400');
        }
      }
    };

    this.btnFire.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        e.preventDefault();
        setTouchFireState(true);
      },
      { passive: false }
    );

    this.btnFire.addEventListener(
      'touchend',
      (e: TouchEvent) => {
        e.preventDefault();
        setTouchFireState(false);
      },
      { passive: false }
    );

    this.btnFire.addEventListener(
      'touchcancel',
      (e: TouchEvent) => {
        e.preventDefault();
        setTouchFireState(false);
      },
      { passive: false }
    );
  }

  /**
   * Polls connected gamepads on each animation frame.
   */
  private pollGamepad() {
    if (!navigator.getGamepads) return;

    const gamepads = navigator.getGamepads();
    if (!gamepads) return;

    let activePad: Gamepad | null = null;
    for (let i = 0; i < gamepads.length; i++) {
      const pad = gamepads[i];
      if (pad && pad.connected) {
        activePad = pad;
        break;
      }
    }

    if (!activePad) {
      if (this.gamepadState.connected) {
        this.gamepadState.connected = false;
        this.gamepadState.active = false;
        this.updateTouchUIVisibility();
      }
      return;
    }

    if (!this.gamepadState.connected) {
      this.gamepadState.connected = true;
      this.gamepadState.id = activePad.id;
      this.updateTouchUIVisibility();
    }

    // 1. Left Analog Stick (Axes 0 & 1)
    const deadzone = 0.18;
    const axisX = activePad.axes[0] || 0;
    const axisY = activePad.axes[1] || 0;
    const stickMagnitude = Math.hypot(axisX, axisY);

    let hasGamepadInput = false;

    if (stickMagnitude > deadzone) {
      hasGamepadInput = true;
      this.gamepadState.joystickActive = true;
      this.gamepadState.targetAngle = Math.atan2(axisY, axisX);
      this.gamepadState.intensity = Math.min(1, (stickMagnitude - deadzone) / (1 - deadzone));
    } else {
      this.gamepadState.joystickActive = false;
      this.gamepadState.intensity = 0;
    }

    // 2. D-pad (Buttons 12-up, 13-down, 14-left, 15-right)
    const bUp = activePad.buttons[12]?.pressed;
    const bDown = activePad.buttons[13]?.pressed;
    const bLeft = activePad.buttons[14]?.pressed;
    const bRight = activePad.buttons[15]?.pressed;

    this.gamepadState.forward = !!bUp;
    this.gamepadState.backward = !!bDown;
    this.gamepadState.turnLeft = !!bLeft;
    this.gamepadState.turnRight = !!bRight;

    if (bUp || bDown || bLeft || bRight) {
      hasGamepadInput = true;
    }

    // 3. Fire Buttons:
    // Button 0 (A / Cross), Button 7 (RT / R2), Button 5 (RB / R1), Button 2 (X / Square)
    const btnA = activePad.buttons[0]?.pressed || (activePad.buttons[0]?.value || 0) > 0.5;
    const btnRT = activePad.buttons[7]?.pressed || (activePad.buttons[7]?.value || 0) > 0.3;
    const btnRB = activePad.buttons[5]?.pressed || (activePad.buttons[5]?.value || 0) > 0.5;
    const btnX = activePad.buttons[2]?.pressed || (activePad.buttons[2]?.value || 0) > 0.5;

    this.gamepadState.shoot = !!(btnA || btnRT || btnRB || btnX);
    if (this.gamepadState.shoot) {
      hasGamepadInput = true;
    }

    // Track active status
    if (hasGamepadInput) {
      const now = performance.now();
      if (!this.gamepadState.active) {
        this.gamepadState.active = true;
        this.updateTouchUIVisibility();
      }
      this.gamepadState.lastActiveTime = now;
    } else if (this.gamepadState.active) {
      // Auto relax gamepad active flag after 10s of inactivity if needed
      if (performance.now() - this.gamepadState.lastActiveTime > 10000) {
        this.gamepadState.active = false;
        this.updateTouchUIVisibility();
      }
    }
  }

  /**
   * Updates Touch UI visibility based on:
   * 1. Game State (must be in-game)
   * 2. User Settings Toggle (Touch UI Enabled)
   * 3. Device Capability (touch vs non-touch)
   * 4. Gamepad Connection State (auto-hide when gamepad is actively connected)
   */
  public updateTouchUIVisibility() {
    if (!this.touchControlsContainer) {
      this.touchControlsContainer = document.getElementById('mobile-touch-controls');
    }
    if (!this.touchControlsContainer) return;

    // Condition 1: Must be in-game
    if (!this.isCurrentlyInGame) {
      this.touchControlsContainer.classList.add('hidden');
      this.options.onTouchUIVisibilityChanged?.(false);
      return;
    }

    // Condition 2: Settings toggle must be enabled
    if (!this.touchUIEnabled) {
      this.touchControlsContainer.classList.add('hidden');
      this.options.onTouchUIVisibilityChanged?.(false);
      return;
    }

    // Condition 3: If gamepad is actively connected, auto-hide to maximize visual screen
    if (this.gamepadState.connected && this.gamepadState.active) {
      this.touchControlsContainer.classList.add('hidden');
      this.options.onTouchUIVisibilityChanged?.(false);
      return;
    }

    // Condition 4: Non-touch desktop devices default to hidden unless user explicitly enabled
    if (!this.isTouchDevice && !this.touchUIEnabled) {
      this.touchControlsContainer.classList.add('hidden');
      this.options.onTouchUIVisibilityChanged?.(false);
      return;
    }

    // Show Touch UI
    this.touchControlsContainer.classList.remove('hidden');
    this.options.onTouchUIVisibilityChanged?.(true);
  }

  /**
   * Sets game state (in-game vs lobby/login/waiting).
   */
  public setInGame(inGame: boolean) {
    this.isCurrentlyInGame = inGame;
    this.updateTouchUIVisibility();
  }

  /**
   * Sets the user touch UI preference toggle.
   */
  public setTouchUIEnabled(enabled: boolean) {
    this.touchUIEnabled = enabled;
    try {
      localStorage.setItem('tank_touch_ui_enabled', String(enabled));
    } catch (e) {}
    this.updateTouchUIVisibility();
  }

  public getTouchUIEnabled(): boolean {
    return this.touchUIEnabled;
  }

  public isTouchSupported(): boolean {
    return this.isTouchDevice;
  }

  public isGamepadConnected(): boolean {
    return this.gamepadState.connected;
  }

  /**
   * Must be called in each frame of requestAnimationFrame loop.
   * Polls gamepad status and returns the synthesized input state.
   */
  public update(): UnifiedInputState {
    this.pollGamepad();

    // 1. Synthesize Movement (Keyboard, D-pad, Joystick, Analog Stick)
    const kbForward = !!(this.keys['KeyW'] || this.keys['ArrowUp']);
    const kbBackward = !!(this.keys['KeyS'] || this.keys['ArrowDown']);
    const kbTurnLeft = !!(this.keys['KeyA'] || this.keys['ArrowLeft']);
    const kbTurnRight = !!(this.keys['KeyD'] || this.keys['ArrowRight']);

    const forward = kbForward || this.gamepadState.forward;
    const backward = kbBackward || this.gamepadState.backward;
    const turnLeft = kbTurnLeft || this.gamepadState.turnLeft;
    const turnRight = kbTurnRight || this.gamepadState.turnRight;

    // 2. Synthesize Joystick / Analog Direction
    let joystickActive = false;
    let targetAngle = 0;
    let intensity = 0;

    if (this.gamepadState.joystickActive && this.gamepadState.intensity > 0) {
      joystickActive = true;
      targetAngle = this.gamepadState.targetAngle;
      intensity = this.gamepadState.intensity;
    } else if (this.touchJoystick.active && this.touchJoystick.intensity > 0) {
      joystickActive = true;
      targetAngle = this.touchJoystick.targetAngle;
      intensity = this.touchJoystick.intensity;
    }

    // 3. Synthesize Shoot (Space, Left Mouse, Touch Button, Gamepad Button)
    const kbShoot = !!(this.keys['Space'] || this.keys['Mouse0'] || this.isMouseDown);
    const touchShoot = this.touchFire.active;
    const gamepadShoot = this.gamepadState.shoot;

    const shoot = kbShoot || touchShoot || gamepadShoot;

    const state: UnifiedInputState = {
      forward,
      backward,
      turnLeft,
      turnRight,
      shoot,
      joystickActive,
      targetAngle,
      intensity,
      isGamepadActive: this.gamepadState.connected && this.gamepadState.active,
      isTouchActive: this.touchJoystick.active || this.touchFire.active,
    };

    return state;
  }
}
