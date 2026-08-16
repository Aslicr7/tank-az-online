/**
 * Tank AZ Online - AI Bot Engine (CommonJS, Node.js 14 compatible)
 */

var { PhysicsEngine } = require('./physics.js');

class BotAI {
  /**
   * Calculates a valid ricochet bounce point off walls to hit a target behind cover (Hard Bot feature).
   */
  static findRicochetShot(bot, target, walls) {
    var bestBouncePoint = null;
    var minTotalDist = Infinity;

    for (var i = 0; i < walls.length; i++) {
      var wall = walls[i];
      var Px = 0;
      var Py = 0;
      var validSegment = false;

      if (wall.y1 === wall.y2) {
        // Horizontal wall segment
        var Wy = wall.y1;
        var refTy = 2 * Wy - target.y;
        var dy = refTy - bot.y;
        if (Math.abs(dy) < 0.001) continue;

        var t = (Wy - bot.y) / dy;
        if (t <= 0.05 || t >= 0.95) continue;

        Px = bot.x + t * (target.x - bot.x);
        Py = Wy;

        var minX = Math.min(wall.x1, wall.x2) - 5;
        var maxX = Math.max(wall.x1, wall.x2) + 5;
        if (Px >= minX && Px <= maxX) {
          validSegment = true;
        }
      } else if (wall.x1 === wall.x2) {
        // Vertical wall segment
        var Wx = wall.x1;
        var refTx = 2 * Wx - target.x;
        var dx = refTx - bot.x;
        if (Math.abs(dx) < 0.001) continue;

        var t = (Wx - bot.x) / dx;
        if (t <= 0.05 || t >= 0.95) continue;

        Px = Wx;
        Py = bot.y + t * (target.y - bot.y);

        var minY = Math.min(wall.y1, wall.y2) - 5;
        var maxY = Math.max(wall.y1, wall.y2) + 5;
        if (Py >= minY && Py <= maxY) {
          validSegment = true;
        }
      }

      if (validSegment) {
        var bouncePoint = { x: Px, y: Py };
        var otherWalls = [];
        for (var j = 0; j < walls.length; j++) {
          if (walls[j].id !== wall.id) {
            otherWalls.push(walls[j]);
          }
        }

        // Check line of sight from bot to bounce point
        if (!PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, bouncePoint, otherWalls)) {
          continue;
        }

        // Check line of sight from bounce point to target
        if (!PhysicsEngine.hasLineOfSight(bouncePoint, { x: target.x, y: target.y }, otherWalls)) {
          continue;
        }

        var totalDist =
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

  static updateBot(bot, players, bullets, walls, powerups, mapWidth, mapHeight, now) {
    var forward = false;
    var backward = false;
    var turnLeft = false;
    var turnRight = false;
    var shoot = false;
    var turretTargetAngle = bot.turretAngle;

    var targets = [];
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.id !== bot.id && p.hp > 0 && (!bot.team || p.team !== bot.team)) {
        targets.push(p);
      }
    }

    if (targets.length === 0) {
      var turnL = Math.random() < 0.2;
      var turnR = !turnL && Math.random() < 0.2;
      return { forward: true, backward: false, turnLeft: turnL, turnRight: turnR, shoot: false, turretTargetAngle: bot.bodyAngle };
    }

    var nearestTarget = targets[0];
    var minDist = Infinity;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var dist = Math.hypot(t.x - bot.x, t.y - bot.y);
      if (dist < minDist) {
        minDist = dist;
        nearestTarget = t;
      }
    }

    // 1. Bullet Dodge Routine (Smart AI dodges incoming enemy bullets)
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.ownerId === bot.id) continue;
      var bToBotX = bot.x - b.x;
      var bToBotY = bot.y - b.y;
      var distToBullet = Math.hypot(bToBotX, bToBotY);

      if (distToBullet < 200) {
        var bSpeed = Math.hypot(b.vx, b.vy);
        if (bSpeed > 0) {
          var dot = (b.vx * bToBotX + b.vy * bToBotY) / (bSpeed * distToBullet);
          if (dot > 0.8) {
            var perpX = -b.vy;
            var perpY = b.vx;
            bot.bodyAngle = Math.atan2(perpY, perpX);
            forward = true;
            return { forward: forward, backward: backward, turnLeft: turnLeft, turnRight: turnRight, shoot: false, turretTargetAngle: bot.turretAngle };
          }
        }
      }
    }

    // 2. Line of sight check & Aim calculation
    var aimPoint = { x: nearestTarget.x, y: nearestTarget.y };
    var hasDirectLOS = PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, aimPoint, walls);

    var ricochetPoint = null;
    var finalAimTarget = aimPoint;

    if (hasDirectLOS) {
      finalAimTarget = aimPoint;
    } else {
      ricochetPoint = BotAI.findRicochetShot(bot, aimPoint, walls);
      if (ricochetPoint) {
        finalAimTarget = ricochetPoint;
      }
    }

    var dx = finalAimTarget.x - bot.x;
    var dy = finalAimTarget.y - bot.y;
    turretTargetAngle = Math.atan2(dy, dx);

    var angleDiff = turretTargetAngle - bot.turretAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    var turretTurnRate = 0.25;
    bot.turretAngle += (angleDiff > 0 ? 1 : angleDiff < 0 ? -1 : 0) * Math.min(Math.abs(angleDiff), turretTurnRate);

    // 3. Shooting decision with Raycast validation (Never shoot aimlessly into walls)
    var isAimedAtTarget = Math.abs(angleDiff) < 0.22;
    var cooldownReady = now - bot.lastShotTime >= bot.shootCooldown * 1000;

    if (cooldownReady && isAimedAtTarget) {
      if (hasDirectLOS) {
        if (Math.random() < 0.95) {
          shoot = true;
        }
      } else if (ricochetPoint) {
        shoot = true;
      }
    }

    // 4. Navigation & Obstacle Avoidance (Pathfinding around walls)
    var destination = aimPoint;

    if (powerups.length > 0) {
      var nearestItem = powerups[0];
      var distToItem = Math.hypot(nearestItem.x - bot.x, nearestItem.y - bot.y);
      if (distToItem < 250) {
        destination = { x: nearestItem.x, y: nearestItem.y };
      }
    }

    if (!hasDirectLOS && destination === aimPoint) {
      var directMoveAngle = Math.atan2(aimPoint.y - bot.y, aimPoint.x - bot.x);
      var probeOffsets = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
      var bestProbe = null;
      var minProbeDist = Infinity;

      for (var k = 0; k < probeOffsets.length; k++) {
        var probeAngle = directMoveAngle + probeOffsets[k];
        var probePt = {
          x: bot.x + Math.cos(probeAngle) * 130,
          y: bot.y + Math.sin(probeAngle) * 130,
        };

        if (PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, probePt, walls)) {
          var distToTarget = Math.hypot(aimPoint.x - probePt.x, aimPoint.y - probePt.y);
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

    var moveDx = destination.x - bot.x;
    var moveDy = destination.y - bot.y;
    var targetMoveAngle = Math.atan2(moveDy, moveDx);

    var moveAngleDiff = targetMoveAngle - bot.bodyAngle;
    while (moveAngleDiff > Math.PI) moveAngleDiff -= Math.PI * 2;
    while (moveAngleDiff < -Math.PI) moveAngleDiff += Math.PI * 2;

    if (Math.abs(moveAngleDiff) > 0.15) {
      if (moveAngleDiff > 0) turnRight = true;
      else turnLeft = true;
    } else {
      forward = true;
    }

    // 5. Front Wall Collision Avoidance (Steer away before hitting wall)
    var frontX = bot.x + Math.cos(bot.bodyAngle) * 35;
    var frontY = bot.y + Math.sin(bot.bodyAngle) * 35;
    if (!PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, { x: frontX, y: frontY }, walls)) {
      var leftProbeX = bot.x + Math.cos(bot.bodyAngle - Math.PI / 3) * 40;
      var leftProbeY = bot.y + Math.sin(bot.bodyAngle - Math.PI / 3) * 40;
      var leftClear = PhysicsEngine.hasLineOfSight({ x: bot.x, y: bot.y }, { x: leftProbeX, y: leftProbeY }, walls);

      if (leftClear) {
        turnLeft = true;
        turnRight = false;
      } else {
        turnRight = true;
        turnLeft = false;
      }
      forward = true;
    }

    return { forward: forward, backward: backward, turnLeft: turnLeft, turnRight: turnRight, shoot: shoot, turretTargetAngle: bot.turretAngle };
  }
}

exports.BotAI = BotAI;
module.exports = exports;
