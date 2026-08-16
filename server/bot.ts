/**
 * Tank AZ Online - AI Bot Engine
 * Implements intelligent AI tank behavior, aim prediction, ricochet trick shots, and dodge routines.
 */

import { PhysicsEngine, WallSegment, Point } from './physics.ts';

export interface BotState {
  id: string;
  name: string;
  difficulty?: 'easy' | 'medium' | 'hard' | 'smart' | string;
  x: number;
  y: number;
  bodyAngle: number;
  turretAngle: number;
  radius: number;
  moveSpeed: number;
  turnRate?: number;
  isBot: boolean;
  color: string;
  hp: number;
  maxHp: number;
  score: number;
  kills: number;
  deaths: number;
  team?: 'red' | 'blue' | 'none' | string;
  lastShotTime: number;
  shootCooldown: number;
  activePowerup?: string;
  powerupTimer?: number;
  activeBulletType?: string;
  specialAmmo?: number;
  shieldTimer?: number;
  speedTimer?: number;
  rapidFireTimer?: number;
  extraLife?: boolean;
  extraLives?: number;
  alive?: boolean;
  isDead?: boolean;
}

export class BotAI {
  /**
   * Calculates a valid ricochet bounce point off walls to hit a target behind cover (Hard Bot feature).
   */
  static findRicochetShot(
    bot: { x: number; y: number },
    target: { x: number; y: number },
    walls: WallSegment[]
  ): Point | null {
    let bestBouncePoint: Point | null = null;
    let minTotalDist = Infinity;

    for (const wall of walls) {
      let Px = 0;
      let Py = 0;
      let validSegment = false;

      if (wall.y1 === wall.y2) {
        // Horizontal wall segment
        const Wy = wall.y1;
        const refTy = 2 * Wy - target.y;
        const dy = refTy - bot.y;
        if (Math.abs(dy) < 0.001) continue;

        const t = (Wy - bot.y) / dy;
        if (t <= 0.05 || t >= 0.95) continue;

        Px = bot.x + t * (target.x - bot.x);
        Py = Wy;

        const minX = Math.min(wall.x1, wall.x2) - 5;
        const maxX = Math.max(wall.x1, wall.x2) + 5;
        if (Px >= minX && Px <= maxX) {
          validSegment = true;
        }
      } else if (wall.x1 === wall.x2) {
        // Vertical wall segment
        const Wx = wall.x1;
        const refTx = 2 * Wx - target.x;
        const dx = refTx - bot.x;
        if (Math.abs(dx) < 0.001) continue;

        const t = (Wx - bot.x) / dx;
        if (t <= 0.05 || t >= 0.95) continue;

        Px = Wx;
        Py = bot.y + t * (target.y - bot.y);

        const minY = Math.min(wall.y1, wall.y2) - 5;
        const maxY = Math.max(wall.y1, wall.y2) + 5;
        if (Py >= minY && Py <= maxY) {
          validSegment = true;
        }
      }

      if (validSegment) {
        const bouncePoint = { x: Px, y: Py };
        const otherWalls = walls.filter((w) => w.id !== wall.id);

        // Check line of sight from bot to bounce point
        if (!PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, bouncePoint, otherWalls)) {
          continue;
        }

        // Check line of sight from bounce point to target
        if (!PhysicsEngine.hasLineOfSight(bouncePoint, { x: target.x, y: target.y }, otherWalls)) {
          continue;
        }

        const totalDist =
          Math.hypot(bouncePoint.x - bot.x, bouncePoint.y - bot.y) +
          Math.hypot(target.x - bouncePoint.x, target.y - bouncePoint.y);

        if (totalDist < minTotalDist) {
          minTotalDist = totalDist;
          bestBouncePoint = bouncePoint;
        }
      }
    }

    return bestBouncePoint;
  }

  /**
   * Updates a Bot's decisions and movement inputs.
   */
  static updateBot(
    bot: BotState,
    players: BotState[],
    bullets: { x: number; y: number; vx: number; vy: number; ownerId: string }[],
    walls: WallSegment[],
    powerups: { id: string; x: number; y: number; type: string }[],
    mapWidth: number,
    mapHeight: number,
    now: number
  ): { forward: boolean; backward: boolean; turnLeft: boolean; turnRight: boolean; shoot: boolean; turretTargetAngle: number } {
    let forward = false;
    let backward = false;
    let turnLeft = false;
    let turnRight = false;
    let shoot = false;
    let turretTargetAngle = bot.turretAngle;

    // Filter potential targets (excluding self and teammates if team battle)
    const targets = players.filter((p) => p.id !== bot.id && p.hp > 0 && (!bot.team || p.team !== bot.team));
    if (targets.length === 0) {
      // Just wander randomly if no target
      const turnL = Math.random() < 0.2;
      const turnR = !turnL && Math.random() < 0.2;
      return { forward: true, backward: false, turnLeft: turnL, turnRight: turnR, shoot: false, turretTargetAngle: bot.bodyAngle };
    }

    // Find nearest target tank
    let nearestTarget = targets[0];
    let minSqDist = Infinity;
    for (const t of targets) {
      const dx = t.x - bot.x;
      const dy = t.y - bot.y;
      const sqDist = dx * dx + dy * dy;
      if (sqDist < minSqDist) {
        minSqDist = sqDist;
        nearestTarget = t;
      }
    }

    const isSmart = !bot.difficulty || bot.difficulty === 'smart' || bot.difficulty === 'hard';
    const isMedium = bot.difficulty === 'medium';

    // 1. Bullet Dodge Routine (Smart AI dodges incoming enemy bullets)
    if (isSmart) {
      for (const b of bullets) {
        if (b.ownerId === bot.id) continue;
        const bToBotX = bot.x - b.x;
        const bToBotY = bot.y - b.y;
        const bulletSqDist = bToBotX * bToBotX + bToBotY * bToBotY;

        if (bulletSqDist < 40000) { // < 200px
          const distToBullet = Math.sqrt(bulletSqDist);
          const bSpeed = Math.hypot(b.vx, b.vy);
          if (bSpeed > 0 && distToBullet > 0) {
            const dot = (b.vx * bToBotX + b.vy * bToBotY) / (bSpeed * distToBullet);
            if (dot > 0.8) {
              const perpX = -b.vy;
              const perpY = b.vx;
              bot.bodyAngle = Math.atan2(perpY, perpX);
              forward = true;
              return { forward, backward, turnLeft, turnRight, shoot: false, turretTargetAngle: bot.turretAngle };
            }
          }
        }
      }
    }

    // 2. Line of sight check & Aim calculation
    const aimPoint: Point = { x: nearestTarget.x, y: nearestTarget.y };
    const hasDirectLOS = PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, aimPoint, walls);

    let ricochetPoint: Point | null = null;
    let finalAimTarget: Point = aimPoint;

    if (hasDirectLOS) {
      finalAimTarget = aimPoint;
    } else if (isSmart) {
      // Smart AI ricochet calculation when no direct line of sight
      ricochetPoint = BotAI.findRicochetShot(bot, aimPoint, walls);
      if (ricochetPoint) {
        finalAimTarget = ricochetPoint;
      }
    }

    // Aim turret toward final Aim Target (Direct or Ricochet Point)
    const dx = finalAimTarget.x - bot.x;
    const dy = finalAimTarget.y - bot.y;
    turretTargetAngle = Math.atan2(dy, dx);

    let angleDiff = turretTargetAngle - bot.turretAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turretTurnRate = isSmart ? 0.25 : isMedium ? 0.18 : 0.1;
    bot.turretAngle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), turretTurnRate);

    // 3. Shooting decision with Raycast validation
    const isAimedAtTarget = Math.abs(angleDiff) < (isSmart ? 0.22 : 0.35);
    const cooldownReady = now - bot.lastShotTime >= bot.shootCooldown * 1000;

    if (cooldownReady && isAimedAtTarget) {
      if (hasDirectLOS) {
        const shootProb = isSmart ? 0.95 : isMedium ? 0.7 : 0.45;
        if (Math.random() < shootProb) {
          shoot = true;
        }
      } else if (isSmart && ricochetPoint) {
        // Smart AI executes ricochet trick shot off wall!
        shoot = true;
      }
    }

    // 4. Navigation & Obstacle Avoidance (Pathfinding around walls)
    let destination: Point = aimPoint;

    // Powerup seeking if close
    if (powerups.length > 0) {
      const nearestItem = powerups[0];
      const pdx = nearestItem.x - bot.x;
      const pdy = nearestItem.y - bot.y;
      if (pdx * pdx + pdy * pdy < 62500) { // < 250px
        destination = { x: nearestItem.x, y: nearestItem.y };
      }
    }

    // Flank / Waypoint Probe when blocked by wall
    if (!hasDirectLOS && destination === aimPoint) {
      const directMoveAngle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);
      const probeOffsets = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
      let bestProbe: Point | null = null;
      let minProbeDist = Infinity;

      for (const offset of probeOffsets) {
        const probeAngle = directMoveAngle + offset;
        const probePt: Point = {
          x: bot.x + Math.cos(probeAngle) * 130,
          y: bot.y + Math.sin(probeAngle) * 130,
        };

        if (PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, probePt, walls)) {
          const distToTarget = Math.hypot(aimPoint.x - probePt.x, aimPoint.y - probePt.y);
          if (distToTarget < minProbeDist) {
            minProbeDist = distToTarget;
            bestProbe = probePt;
          }
        }
      }

      if (bestProbe) {
        destination = bestProbe;
      }
    }

    const moveDx = destination.x - bot.x;
    const moveDy = destination.y - bot.y;
    const targetMoveAngle = Math.atan2(moveDy, moveDx);

    let moveAngleDiff = targetMoveAngle - bot.bodyAngle;
    while (moveAngleDiff > Math.PI) moveAngleDiff -= Math.PI * 2;
    while (moveAngleDiff < -Math.PI) moveAngleDiff += Math.PI * 2;

    if (Math.abs(moveAngleDiff) > 0.15) {
      if (moveAngleDiff > 0) turnRight = true;
      else turnLeft = true;
    } else {
      forward = true;
    }

    // 5. Front Wall Collision Avoidance (Steer away before hitting wall)
    const frontX = bot.x + Math.cos(bot.bodyAngle) * 35;
    const frontY = bot.y + Math.sin(bot.bodyAngle) * 35;
    if (!PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, { x: frontX, y: frontY }, walls)) {
      // Wall immediately ahead! Turn to clearer side
      const leftProbeX = bot.x + Math.cos(bot.bodyAngle - Math.PI / 3) * 40;
      const leftProbeY = bot.y + Math.sin(bot.bodyAngle - Math.PI / 3) * 40;
      const leftClear = PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, { x: leftProbeX, y: leftProbeY }, walls);

      if (leftClear) {
        turnLeft = true;
        turnRight = false;
      } else {
        turnRight = true;
        turnLeft = false;
      }
      forward = true;
    }

    return { forward, backward, turnLeft, turnRight, shoot, turretTargetAngle: bot.turretAngle };
  }
}
