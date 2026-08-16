/**
 * Tank AZ Online - Tank Player Graphics & Controller
 * Renders cute pastel tank chassis, sticker badge, rotating turret, emotes, spawn invincibility, and shield aura.
 */

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

export interface OverheadPassive {
  id: string;
  name: string;
  icon?: string;
  text: string;
  color: string;
  strokeColor?: string;
  shadowColor?: string;
}

/**
 * Height occupied by an overhead passive text indicator (Group 3 effects)
 */
export const OVERHEAD_PASSIVE_HEIGHT = 18;

/**
 * Standard Y offsets relative to player.y (Xếp tầng từ dưới lên trên)
 * Tầng 1: Cụm gốc gồm [Tam giác vàng + Tên nền mờ]: y = player.y - 32px
 * Tầng 2: Nội tại nhóm 3 (❤️ Mạng phụ): y = player.y - 54px (thoáng phía trên chóp mũi tên vàng)
 * Tầng 3: Bong bóng Emoji:
 *   - Khi KHÔNG CÓ nội tại nhóm 3: y = player.y - 52px
 *   - Khi CÓ nội tại nhóm 3: y = player.y - 70px
 */
export const BASE_NAME_OFFSET_Y = -32; // Tầng 1: y = player.y - 32px
export const BASE_OVERHEAD_OFFSET_Y = -58; // Tầng 2: y = player.y - 56px (thoáng phía trên chóp mũi tên vàng)
export const DEFAULT_EMOJI_OFFSET_Y = -52; // Tầng 3 (Không có nội tại): y = player.y - 52px
export const STACKED_EMOJI_OFFSET_Y = -70; // Tầng 3 (Có nội tại): y = player.y - 70px

/**
 * Get all active Group 3 Overhead Passives for a given player/tank.
 * Any new Group 3 passive items added in the future only need to be registered here
 * to automatically trigger overhead display and Dynamic Stacking!
 */
export function getOverheadPassives(tank: any): OverheadPassive[] {
  if (!tank || tank.hp <= 0) return [];
  const passives: OverheadPassive[] = [];

  // 1. Extra Life (❤️ mạng phụ - Nhóm 3: viết thường toàn bộ)
  const extraLives = tank.extraLives ?? (tank.extraLife ? 1 : 0);
  if (extraLives > 0 || tank.hasExtraLife || (Array.isArray(tank.passives) && tank.passives.includes('extraLife'))) {
    passives.push({
      id: 'extraLife',
      name: 'Mạng phụ',
      icon: '❤️',
      text: extraLives > 1 ? `❤️ mạng phụ (x${extraLives})` : '❤️ mạng phụ',
      color: '#f43f5e',
      shadowColor: '#be123c',
    });
  }

  // 4. Extensible overhead passives array from player object (player.passives or player.overheadStatus)
  if (Array.isArray(tank.passives)) {
    for (const p of tank.passives) {
      if (typeof p === 'string' && !['extraLife', 'revive', 'immortal'].includes(p)) {
        passives.push({
          id: p,
          name: p,
          text: p,
          color: '#fb7185',
          shadowColor: '#e11d48',
        });
      }
    }
  }

  if (Array.isArray(tank.overheadStatus)) {
    for (const s of tank.overheadStatus) {
      if (typeof s === 'string') {
        passives.push({
          id: s,
          name: s,
          text: s,
          color: '#fb7185',
          shadowColor: '#e11d48',
        });
      } else if (s && typeof s === 'object' && s.text) {
        passives.push({
          id: s.id || 'custom_passive',
          name: s.name || s.text,
          icon: s.icon,
          text: s.text,
          color: s.color || '#fb7185',
          shadowColor: s.shadowColor || '#e11d48',
        });
      }
    }
  }

  return passives;
}

/**
 * Checks if a player has any active Group 3 overhead passive
 */
export function hasOverheadPassive(tank: any): boolean {
  return getOverheadPassives(tank).length > 0;
}

export class TankRenderer {
  /**
   * Draws a floating chat emoji speech bubble with dynamic stacking offset.
   */
  static drawEmojiBubble(
    ctx: CanvasRenderingContext2D,
    renderX: number,
    renderY: number,
    emoji: string,
    startedAt: number,
    expiresAt: number,
    hasPassive: boolean
  ) {
    const now = Date.now();
    const remainingMs = expiresAt - now;
    if (remainingMs <= 0) return;

    ctx.save();
    const totalDuration = Math.max(1000, expiresAt - startedAt);
    const elapsed = Math.max(0, Math.min(totalDuration, now - startedAt));
    const elapsedRatio = elapsed / totalDuration;

    // CƠ CHẾ TỰ ĐỘNG ĐẨY BONG BÓNG EMOJI LÊN TRÊN (DYNAMIC STACKING):
    // - Tầng 3 (Không có nội tại nhóm 3): baseOffsetY = 52px (DEFAULT_EMOJI_OFFSET_Y = -52px)
    // - Tầng 3 (Có nội tại nhóm 3): baseOffsetY = 70px (STACKED_EMOJI_OFFSET_Y = -70px)
    const baseOffsetY = hasPassive ? -STACKED_EMOJI_OFFSET_Y : -DEFAULT_EMOJI_OFFSET_Y; // 70px vs 52px

    // Hiệu ứng nổi nhẹ nhàng lên trên (Floating)
    const floatOffsetY = elapsedRatio * 10 + Math.sin(now * 0.008) * 2;
    const bubbleAnchorY = renderY - baseOffsetY - floatOffsetY;

    // Hiệu ứng xuất hiện: Nảy lên (Pop-up scale) trong 120ms đầu (0.2 -> 1.15 -> 1.0)
    let scale = 1.0;
    if (elapsed < 120) {
      const t = elapsed / 120;
      scale = t < 0.7 ? (t / 0.7) * 1.15 : 1.15 - ((t - 0.7) / 0.3) * 0.15;
    }

    // Mờ dần (Fade-out alpha) trong 300ms cuối trước khi biến mất
    let opacity = 1.0;
    if (remainingMs < 300) {
      opacity = Math.max(0, remainingMs / 300);
    }
    ctx.globalAlpha = opacity;

    const emojiStr = String(emoji);

    ctx.translate(renderX, bubbleAnchorY);
    ctx.scale(scale, scale);

    // Kích thước bong bóng chat gọn gàng: 38px x 34px
    const bw = 38;
    const bh = 34;
    const br = 10;

    // Vẽ bóng đổ nhẹ (box-shadow / ctx.shadowBlur = 4) giúp nổi bật trên mọi nền map
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    // Nền bong bóng chat màu trắng tinh tế
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(-bw / 2, -bh, bw, bh, br);
    ctx.fill();

    // Đuôi tam giác/mũi nhọn nhỏ chỉ thẳng xuống đầu tháp pháo xe tăng
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, 5);
    ctx.closePath();
    ctx.fill();

    // Viền nét mảnh tinh tế (border: 1.5px)
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.95)'; // Slate-300
    ctx.stroke();

    // In icon Emoji căn chính giữa tâm của bong bóng
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emojiStr, 0, -bh / 2);

    ctx.restore();
  }

  static renderTank(ctx: CanvasRenderingContext2D, tank: any, isLocalPlayer = false, activeEmojiEffect?: any) {
    if (tank.hp <= 0) return;

    ctx.save();

    // Spawn Invincibility Flashing
    if (tank.isInvincible) {
      ctx.globalAlpha = 0.45 + Math.sin(Date.now() * 0.018) * 0.35;
    }

    const tx = Math.floor(tank.x);
    const ty = Math.floor(tank.y);

    ctx.translate(tx, ty);

    // 1. Shield Powerup Aura & Speed Aura
    const now = Date.now();
    const hasShield = (tank.shieldTimer && now < tank.shieldTimer) || tank.activePowerup === 'shield';
    const hasSpeed = (tank.speedTimer && now < tank.speedTimer) || tank.activePowerup === 'speed';

    // Speed boost golden aura & particles (Nhóm 2: chỉ hào quang quanh thân xe)
    if (hasSpeed) {
      ctx.save();
      const pulseSpeed = Math.sin(now * 0.015) * 2;
      ctx.beginPath();
      ctx.arc(0, 0, tank.radius + 6 + pulseSpeed, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(250, 204, 21, 0.15)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
      ctx.shadowColor = '#facc15';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    }

    // Shield protective blue aura (Nhóm 2: chỉ hào quang quanh thân xe)
    if (hasShield) {
      ctx.save();
      const shieldPulse = Math.sin(now * 0.01) * 2;
      ctx.beginPath();
      ctx.arc(0, 0, tank.radius + 12 + shieldPulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3b82f6';
      ctx.shadowColor = '#60a5fa';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Tank Shadow
    ctx.save();
    ctx.rotate(tank.bodyAngle);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.roundRect(-tank.radius + 3, -tank.radius + 3, tank.radius * 2, tank.radius * 2, 8);
    ctx.fill();
    ctx.restore();

    // Determine Tank Theme Colors based on Team or Individual Color
    const isTeamRed = tank.team === 'red';
    const isTeamBlue = tank.team === 'blue';
    const primaryColor = isTeamRed ? '#ef4444' : (isTeamBlue ? '#3b82f6' : (tank.color || '#f472b6'));
    const darkAccentColor = isTeamRed ? '#991b1b' : (isTeamBlue ? '#1e40af' : '#334155');
    const barrelFillColor = isTeamRed ? '#b91c1c' : (isTeamBlue ? '#1d4ed8' : '#475569');
    const barrelBorderColor = isTeamRed ? '#7f1d1d' : (isTeamBlue ? '#1e3a8a' : '#1e293b');

    // 3. Tank Body (Chassis) & Treads
    ctx.save();
    ctx.rotate(tank.bodyAngle);

    // Treads
    ctx.fillStyle = darkAccentColor;
    ctx.beginPath();
    ctx.roundRect(-tank.radius - 2, -tank.radius - 3, tank.radius * 2 + 4, 7, 3);
    ctx.roundRect(-tank.radius - 2, tank.radius - 4, tank.radius * 2 + 4, 7, 3);
    ctx.fill();

    // Main Chassis Hull
    ctx.fillStyle = primaryColor;
    ctx.beginPath();
    ctx.roundRect(-tank.radius, -tank.radius + 2, tank.radius * 2, (tank.radius - 2) * 2, 8);
    ctx.fill();

    // Hull border
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = isLocalPlayer ? '#facc15' : (isTeamRed ? '#f87171' : (isTeamBlue ? '#60a5fa' : 'rgba(0, 0, 0, 0.3)'));
    ctx.stroke();

    // Cute front lights
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(tank.radius - 2, -tank.radius + 5, 2.5, 0, Math.PI * 2);
    ctx.arc(tank.radius - 2, tank.radius - 5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore(); // End body rotation

    // 4. Rotating Turret & Barrel
    ctx.save();
    ctx.rotate(tank.turretAngle);

    // Cannon Barrel
    const barrelLength = tank.radius + 12;
    const barrelWidth = 8;
    ctx.fillStyle = barrelFillColor;
    ctx.beginPath();
    ctx.roundRect(0, -barrelWidth / 2, barrelLength, barrelWidth, 3);
    ctx.fill();

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = barrelBorderColor;
    ctx.stroke();

    // Special Bullet tip energy indicator
    const activeBullet = tank.activeBulletType || (
      ['fastBullet', 'bigBullet', 'crazyBounce', 'laser'].includes(tank.activePowerup)
        ? tank.activePowerup
        : undefined
    );
    const ammoLeft = tank.specialAmmo !== undefined ? tank.specialAmmo : 5;
    if (activeBullet && ammoLeft > 0) {
      ctx.save();
      let tipColor = '#facc15';
      if (activeBullet === 'fastBullet') tipColor = '#ef4444';
      else if (activeBullet === 'bigBullet') tipColor = '#a855f7';
      else if (activeBullet === 'crazyBounce') tipColor = '#10b981';
      else if (activeBullet === 'laser') tipColor = '#f87171';

      ctx.beginPath();
      ctx.arc(barrelLength, 0, activeBullet === 'bigBullet' ? 5.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = tipColor;
      ctx.shadowColor = tipColor;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }

    // Turret Dome Center
    ctx.beginPath();
    ctx.arc(0, 0, tank.radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = primaryColor;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = isTeamRed ? '#7f1d1d' : (isTeamBlue ? '#1e3a8a' : '#1e293b');
    ctx.stroke();

    ctx.restore(); // End turret rotation

    // Sticker / Skin icon on center of tank
    const sticker = tank.sticker || '🐥';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sticker, 0, -1);

    ctx.restore(); // Restore global translation

    // 5. Name tag & Overhead Passives & Emote Speech Bubble
    const renderX = Math.floor(tank.x);
    const renderY = Math.floor(tank.y);

    // =========================================================================
    // TẦNG 1: CỤM TÊN NGƯỜI CHƠI [Mũi tên vàng + Tên nền mờ] (y = player.y - 32px)
    // =========================================================================
    ctx.save();
    ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const nameCenterY = renderY + BASE_NAME_OFFSET_Y; // renderY - 32
    const cleanName = (tank.name || 'Player').replace(/^🤖\s*/, '');
    const nameStr = (tank.isBot ? '🤖 ' : '') + cleanName;
    const textWidth = ctx.measureText(nameStr).width;

    // Nền Badge: Khung hình chữ nhật bo góc nhỏ (roundRect) mờ mờ trong suốt bao quanh chữ tên
    const badgePadX = 7;
    const badgeHeight = 18;
    const badgeWidth = textWidth + badgePadX * 2;
    const badgeTop = nameCenterY - badgeHeight / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(renderX - badgeWidth / 2, badgeTop, badgeWidth, badgeHeight, 5);
    ctx.fill();

    // Mũi Tên Chỉ Hướng Màu Vàng (🔻 Arrow Indicator):
    // Vẽ hình tam giác màu vàng trỏ mũi nhọn xuống dưới, nằm ngay sát phía trên của khung tên (chỉ cho xe người chơi)
    if (isLocalPlayer) {
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.moveTo(renderX, badgeTop - 2); // Đỉnh nhọn chỉ xuống ngay mép trên của khung tên
      ctx.lineTo(renderX - 5, badgeTop - 8); // Cạnh trái
      ctx.lineTo(renderX + 5, badgeTop - 8); // Cạnh phải
      ctx.closePath();
      ctx.fill();
    }

    // Chữ Tên: Màu vàng sáng (#facc15) cho người chơi / Trắng rõ nét cho người khác, căn chính giữa khung nền
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 3;
    ctx.fillStyle = isLocalPlayer ? '#facc15' : '#ffffff';
    ctx.fillText(nameStr, renderX, nameCenterY);
    ctx.restore();

    // =========================================================================
    // TẦNG 2: NỘI TẠI NHÓM 3 (❤️ Mạng phụ / Overhead Status) (y = player.y - 54px)
    // =========================================================================
    const overheadPassives = getOverheadPassives(tank);
    const hasOverhead = overheadPassives.length > 0;

    if (hasOverhead) {
      ctx.save();
      ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Vẽ chữ/icon của nội tại nhóm 3 tại vị trí chuẩn: y = player.y - 54px (nằm thoáng trên mũi tên vàng)
      let currentPassiveY = renderY + BASE_OVERHEAD_OFFSET_Y; // renderY - 54
      for (const passive of overheadPassives) {
        ctx.fillStyle = passive.color;
        if (passive.shadowColor) {
          ctx.shadowColor = passive.shadowColor;
          ctx.shadowBlur = 6;
        } else {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 4;
        }
        ctx.fillText(passive.text, renderX, currentPassiveY);
        currentPassiveY -= OVERHEAD_PASSIVE_HEIGHT;
      }
      ctx.restore();
    }

    // 2. Active powerup badge indicators (Nhóm 1 & Nhóm 2) - HIỂN THỊ DƯỚI THÂN XE, KHÔNG CHIẾM KHÔNG GIAN ĐẦU XE
    const activeBadges: { text: string; color: string }[] = [];

    // Nhóm 1 - ĐẠN: VIẾT HOA TOÀN BỘ + SỐ LƯỢNG ĐẠN CÒN LẠI (Chỉ 1 loại đạn có hiệu lực tại 1 thời điểm)
    const bulletType = tank.activeBulletType || (
      ['fastBullet', 'bigBullet', 'crazyBounce', 'laser', 'piercing', 'spread', 'tripleShot', 'bounce', 'ricochet'].includes(tank.activePowerup)
        ? tank.activePowerup
        : undefined
    );
    const ammoCount = tank.specialAmmo !== undefined ? tank.specialAmmo : 5;
    const hasBulletBuff = Boolean(bulletType && ammoCount > 0);
    if (hasBulletBuff) {
      if (bulletType === 'laser') activeBadges.push({ text: `⚡ ĐẠN LASER (${ammoCount})`, color: '#f87171' });
      else if (bulletType === 'fastBullet') activeBadges.push({ text: `🔥 ĐẠN SIÊU TỐC (${ammoCount})`, color: '#ef4444' });
      else if (bulletType === 'bigBullet' || bulletType === 'piercing' || bulletType === 'spread' || bulletType === 'tripleShot') activeBadges.push({ text: `💣 ĐẠN CỠ LỚN (${ammoCount})`, color: '#a855f7' });
      else if (bulletType === 'crazyBounce' || bulletType === 'bounce' || bulletType === 'ricochet') activeBadges.push({ text: `🪃 ĐẠN SIÊU NẢY (${ammoCount})`, color: '#10b981' });
    }

    // Nhóm 2 - HIỆU ỨNG: Viết Hoa Chữ Cái Đầu (hoạt động song song và cộng dồn)
    if (tank.shieldTimer && now < tank.shieldTimer) {
      activeBadges.push({ text: '🛡️ Khiên Bảo Vệ', color: '#3b82f6' });
    } else if (tank.activePowerup === 'shield' && (!tank.powerupTimer || now < tank.powerupTimer)) {
      activeBadges.push({ text: '🛡️ Khiên Bảo Vệ', color: '#3b82f6' });
    }

    if (tank.speedTimer && now < tank.speedTimer) {
      activeBadges.push({ text: '⚡ Tăng Tốc Độ', color: '#facc15' });
    } else if (tank.activePowerup === 'speed' && (!tank.powerupTimer || now < tank.powerupTimer)) {
      activeBadges.push({ text: '⚡ Tăng Tốc Độ', color: '#facc15' });
    }

    if (tank.rapidFireTimer && now < tank.rapidFireTimer) {
      activeBadges.push({ text: '⏱️ Bắn Liên Tục', color: '#ec4899' });
    } else if (tank.activePowerup === 'rapidFire' && (!tank.powerupTimer || now < tank.powerupTimer)) {
      activeBadges.push({ text: '⏱️ Bắn Liên Tục', color: '#ec4899' });
    }

    if (activeBadges.length > 0) {
      ctx.save();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      let offsetY = tank.radius + 17;
      for (const badge of activeBadges) {
        ctx.fillStyle = badge.color;
        ctx.fillText(badge.text, tank.x, tank.y + offsetY);
        offsetY += 13;
      }
      ctx.restore();
    }

    // 3. Floating Emoji Bubble above Tank with Dynamic Stacking
    const activeEmoji = activeEmojiEffect?.emoji || tank.currentEmoji;
    if (activeEmoji) {
      const expiresAt = activeEmojiEffect?.expiresAt || tank.emojiExpiresAt || (now + 2500);
      const startedAt = activeEmojiEffect?.startedAt || tank.emojiStartedAt || (expiresAt - 2500);

      TankRenderer.drawEmojiBubble(
        ctx,
        renderX,
        renderY,
        activeEmoji,
        startedAt,
        expiresAt,
        hasOverhead
      );
    }

    ctx.restore();
  }
}

export class PlayerNetworkController {
  /**
   * Smoothly interpolates an angle towards target taking the shortest circular path.
   */
  static lerpAngle(current: number, target: number, factor: number): number {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * factor;
  }

  /**
   * Reconciles the local player tank with authoritative server updates.
   * If error is large (> 150px), snaps directly (rubberband).
   * If error is small, smoothly reconciles to server position.
   */
  static reconcileLocalPlayer(tank: any, dt: number) {
    if (tank.targetX === undefined || tank.targetY === undefined) return;
    if (tank.x === undefined) tank.x = tank.targetX;
    if (tank.y === undefined) tank.y = tank.targetY;

    const dx = tank.targetX - tank.x;
    const dy = tank.targetY - tank.y;
    const distSq = dx * dx + dy * dy;

    // Hard rubberband / Teleport threshold (> 150px)
    if (distSq > 22500) {
      tank.x = tank.targetX;
      tank.y = tank.targetY;
      tank.bodyAngle = tank.targetBodyAngle ?? tank.bodyAngle;
      tank.turretAngle = tank.targetTurretAngle ?? tank.turretAngle;
      tank.angle = tank.bodyAngle;
      return;
    }

    // Soft reconciliation Lerp (35% smoothing factor)
    const factor = Math.min(1.0, 0.35 + dt * 5);
    tank.x += dx * factor;
    tank.y += dy * factor;

    // Body Angle reconciliation
    const targetBodyAngle = tank.targetBodyAngle !== undefined ? tank.targetBodyAngle : tank.targetAngle;
    if (targetBodyAngle !== undefined) {
      if (tank.bodyAngle === undefined) tank.bodyAngle = targetBodyAngle;
      tank.bodyAngle = this.lerpAngle(tank.bodyAngle, targetBodyAngle, factor);
      tank.angle = tank.bodyAngle;
    }

    // Turret Angle reconciliation
    const targetTurretAngle = tank.targetTurretAngle !== undefined ? tank.targetTurretAngle : targetBodyAngle;
    if (targetTurretAngle !== undefined) {
      if (tank.turretAngle === undefined) tank.turretAngle = targetTurretAngle;
      tank.turretAngle = this.lerpAngle(tank.turretAngle, targetTurretAngle, factor);
    }
  }

  /**
   * Smoothly interpolates remote players and bots for stutter-free 60fps rendering.
   */
  static interpolateRemotePlayer(tank: any, dt: number) {
    if (tank.targetX === undefined || tank.targetY === undefined) return;
    if (tank.x === undefined) tank.x = tank.targetX;
    if (tank.y === undefined) tank.y = tank.targetY;

    const dx = tank.targetX - tank.x;
    const dy = tank.targetY - tank.y;
    const distSq = dx * dx + dy * dy;

    // Large snap threshold (> 200px, e.g. respawn or spawn)
    if (distSq > 40000) {
      tank.x = tank.targetX;
      tank.y = tank.targetY;
      tank.bodyAngle = tank.targetBodyAngle ?? tank.bodyAngle;
      tank.turretAngle = tank.targetTurretAngle ?? tank.turretAngle;
      tank.angle = tank.bodyAngle;
      return;
    }

    // Smooth interpolation (30% per frame)
    const factor = Math.min(1.0, 0.30 + dt * 4);
    tank.x += dx * factor;
    tank.y += dy * factor;

    // Body Angle Lerp
    const targetBodyAngle = tank.targetBodyAngle !== undefined ? tank.targetBodyAngle : tank.targetAngle;
    if (targetBodyAngle !== undefined) {
      if (tank.bodyAngle === undefined) tank.bodyAngle = targetBodyAngle;
      tank.bodyAngle = this.lerpAngle(tank.bodyAngle, targetBodyAngle, factor);
      tank.angle = tank.bodyAngle;
    }

    // Turret Angle Lerp
    const targetTurretAngle = tank.targetTurretAngle !== undefined ? tank.targetTurretAngle : targetBodyAngle;
    if (targetTurretAngle !== undefined) {
      if (tank.turretAngle === undefined) tank.turretAngle = targetTurretAngle;
      tank.turretAngle = this.lerpAngle(tank.turretAngle, targetTurretAngle, factor);
    }
  }
}
