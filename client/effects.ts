/**
 * Tank AZ Online - Particle & Visual Effects Engine
 * Handles particle explosions, muzzle flashes, spark bounces, camera shake, floating text, and tread marks.
 */

export class Particle {
  x: number = 0;
  y: number = 0;
  vx: number = 0;
  vy: number = 0;
  color: string = '#ffffff';
  size: number = 5;
  maxLife: number = 1;
  life: number = 1;
  shape: string = 'circle';
  alpha: number = 1;
  active: boolean = false;

  constructor(x: number = 0, y: number = 0, vx: number = 0, vy: number = 0, color: string = '#ffffff', size: number = 5, life: number = 1, shape: string = 'circle') {
    this.reset(x, y, vx, vy, color, size, life, shape);
  }

  reset(x: number, y: number, vx: number, vy: number, color: string, size: number, life: number, shape: string = 'circle') {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.color = color;
    this.size = size;
    this.maxLife = life;
    this.life = life;
    this.shape = shape;
    this.alpha = 1;
    this.active = true;
  }

  update(dt: number) {
    if (!this.active) return;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    this.alpha = Math.max(0, this.life / this.maxLife);
    this.size *= 0.97;
    if (this.life <= 0) {
      this.active = false;
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    if (!this.active || this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;

    const px = Math.floor(this.x);
    const py = Math.floor(this.y);

    if (this.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, this.size), 0, Math.PI * 2);
      ctx.fill();
    } else if (this.shape === 'square') {
      ctx.fillRect(px - Math.floor(this.size / 2), py - Math.floor(this.size / 2), Math.floor(this.size), Math.floor(this.size));
    }
    ctx.restore();
  }
}

export class TreadMark {
  x: number = 0;
  y: number = 0;
  angle: number = 0;
  color: string = '#475569';
  alpha: number = 0.35;

  constructor(x: number, y: number, angle: number, color: string) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.color = color;
    this.alpha = 0.35;
  }

  update(dt: number) {
    this.alpha -= dt * 0.05; // Fade slowly over 7 seconds
  }

  render(ctx: CanvasRenderingContext2D) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(Math.floor(this.x), Math.floor(this.y));
    ctx.rotate(this.angle);
    ctx.fillStyle = '#475569';
    ctx.fillRect(-10, -12, 4, 24);
    ctx.fillRect(6, -12, 4, 24);
    ctx.restore();
  }
}

export class FloatingText {
  text: string = '';
  x: number = 0;
  y: number = 0;
  color: string = '#facc15';
  fontSize: number = 16;
  life: number = 1.2;
  alpha: number = 1;

  constructor(text: string, x: number, y: number, color: string = '#facc15', fontSize: number = 16) {
    this.text = text;
    this.x = x;
    this.y = y;
    this.color = color;
    this.fontSize = fontSize;
    this.life = 1.2;
    this.alpha = 1;
  }

  update(dt: number) {
    this.y -= dt * 30;
    this.life -= dt;
    this.alpha = Math.max(0, this.life / 1.2);
  }

  render(ctx: CanvasRenderingContext2D) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.font = `bold ${this.fontSize}px 'Plus Jakarta Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const fx = Math.floor(this.x);
    const fy = Math.floor(this.y);
    ctx.strokeText(this.text, fx, fy);
    ctx.fillText(this.text, fx, fy);
    ctx.restore();
  }
}

export interface ActiveEmojiEffect {
  playerId: string;
  emoji: string;
  expiresAt: number;
  startedAt: number;
}

export class EffectsManager {
  particles: Particle[] = [];
  treadMarks: TreadMark[] = [];
  floatingTexts: FloatingText[] = [];
  activeEmojis: Map<string, ActiveEmojiEffect> = new Map();
  private maxPoolSize: number = 250;

  constructor() {
    this.particles = [];
    this.treadMarks = [];
    this.floatingTexts = [];
    this.activeEmojis = new Map();
  }

  triggerEmoji(playerId: string, emoji: string, durationMs: number = 2500) {
    const now = Date.now();
    this.activeEmojis.set(playerId, {
      playerId,
      emoji,
      expiresAt: now + durationMs,
      startedAt: now,
    });
  }

  getActiveEmoji(playerId: string): ActiveEmojiEffect | undefined {
    const entry = this.activeEmojis.get(playerId);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.activeEmojis.delete(playerId);
      return undefined;
    }
    return entry;
  }

  private spawnParticle(x: number, y: number, vx: number, vy: number, color: string, size: number, life: number, shape: string = 'circle') {
    // 1. Try to find an inactive pooled particle
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].active) {
        this.particles[i].reset(x, y, vx, vy, color, size, life, shape);
        return;
      }
    }

    // 2. If under maxPoolSize, create new particle
    if (this.particles.length < this.maxPoolSize) {
      const p = new Particle(x, y, vx, vy, color, size, life, shape);
      this.particles.push(p);
    }
  }

  triggerExplosion(x: number, y: number, color = '#f97316') {
    // Core flash
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 70 + Math.random() * 180;
      const size = 3 + Math.random() * 7;
      const life = 0.35 + Math.random() * 0.4;
      const pColor = Math.random() < 0.5 ? color : Math.random() < 0.5 ? '#ef4444' : '#facc15';
      this.spawnParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pColor, size, life);
    }

    // Smoke particles
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 20 + Math.random() * 50;
      const size = 6 + Math.random() * 10;
      const life = 0.6 + Math.random() * 0.5;
      this.spawnParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, '#64748b', size, life);
    }

    this.addFloatingText('BOOM!', x, y - 10, '#ef4444', 18);
  }

  triggerMuzzleFlash(x: number, y: number, angle: number) {
    for (let i = 0; i < 6; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.6;
      const speed = 90 + Math.random() * 120;
      const size = 2 + Math.random() * 4;
      this.spawnParticle(x, y, Math.cos(spread) * speed, Math.sin(spread) * speed, '#fef08a', size, 0.12);
    }
  }

  triggerLaserFlash(x: number, y: number, angle: number) {
    for (let i = 0; i < 8; i++) {
      const spread = angle + (Math.random() - 0.5) * 0.4;
      const speed = 120 + Math.random() * 150;
      const size = 3 + Math.random() * 3;
      this.spawnParticle(x, y, Math.cos(spread) * speed, Math.sin(spread) * speed, '#f87171', size, 0.12);
    }
  }

  triggerSparkBounce(x: number, y: number, normal?: any) {
    const baseAngle = normal ? Math.atan2(normal.y, normal.x) : Math.random() * Math.PI * 2;
    for (let i = 0; i < 8; i++) {
      const spread = baseAngle + (Math.random() - 0.5) * 1.2;
      const speed = 50 + Math.random() * 100;
      this.spawnParticle(x, y, Math.cos(spread) * speed, Math.sin(spread) * speed, '#38bdf8', 2.5, 0.2, 'square');
    }
  }

  addTreadMark(x: number, y: number, angle: number, color: string) {
    if (this.treadMarks.length > 200) {
      this.treadMarks.shift();
    }
    this.treadMarks.push(new TreadMark(x, y, angle, color));
  }

  addFloatingText(text: string, x: number, y: number, color?: string, fontSize?: number) {
    if (this.floatingTexts.length > 30) {
      this.floatingTexts.shift();
    }
    this.floatingTexts.push(new FloatingText(text, x, y, color, fontSize));
  }

  update(dt: number) {
    // Update tread marks
    for (let i = this.treadMarks.length - 1; i >= 0; i--) {
      this.treadMarks[i].update(dt);
      if (this.treadMarks[i].alpha <= 0) {
        this.treadMarks.splice(i, 1);
      }
    }

    // Update active particles in pool
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].active) {
        this.particles[i].update(dt);
      }
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      this.floatingTexts[i].update(dt);
      if (this.floatingTexts[i].life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // Clean up expired emojis
    const now = Date.now();
    for (const [pid, entry] of this.activeEmojis.entries()) {
      if (now >= entry.expiresAt) {
        this.activeEmojis.delete(pid);
      }
    }
  }

  renderTreads(ctx: CanvasRenderingContext2D) {
    this.treadMarks.forEach((t) => t.render(ctx));
  }

  renderParticles(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].active) {
        this.particles[i].render(ctx);
      }
    }
    this.floatingTexts.forEach((ft) => ft.render(ctx));
  }
}
