const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Buzz',
  version: '1.20.4',
});

bot.loadPlugin(pathfinder);

bot.once('spawn', async () => {
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  const PICKAXE_NAME = 'iron_pickaxe';
  const TORCH_NAME = 'torch';
  const pickaxeId = mcData.itemsByName[PICKAXE_NAME].id;
  const torchId = mcData.itemsByName[TORCH_NAME].id;
  const chestId = mcData.blocksByName.chest.id;

  // Actively look for a chest as soon as spawns
  bot.chat('Looking for a chest...');
  let chestBlock = await findNearestChest();
  while (!chestBlock) {
    bot.chat('No chest found nearby, moving to explore...');
    await moveRandomlyExploring(2, 6);
    chestBlock = await findNearestChest();
  }
  // Start the process
  try {
    await takeAllIronPickaxes(chestBlock);
    await mineStraightDown(54);
    await bot.waitForTicks(20);
    // Ensure Buzz has an iron pickaxe before mining
    const pickaxe = bot.inventory.items().find(item => item.name === PICKAXE_NAME);
    if (!pickaxe) {
      bot.chat('No iron pickaxe in inventory! Cannot start mining.');
      return;
    }
    await stripMineUntilDiamonds();
  } catch (err) {
    bot.chat(`Error: ${err.message}`);
  }

  async function findNearestChest(maxAttempts = 10, delayTicks = 40) {
    const chestBlock = bot.findBlock({
      matching: chestId,
      maxDistance: 32
    });
    if (chestBlock) return chestBlock;
    bot.chat(`No chest found nearby, searching again...`);
    await bot.waitForTicks(delayTicks);
    return null;
  }

  async function takeAllIronPickaxes(chestBlock) {
    // Walk to the chest
    await bot.pathfinder.goto(new goals.GoalNear(
      chestBlock.position.x,
      chestBlock.position.y,
      chestBlock.position.z,
      1
    ));
    bot.chat('Arrived at chest.');
    await bot.waitForTicks(10);

    // Open the chest
    let chest;
    try {
      chest = await bot.openChest(chestBlock);
      bot.chat('Opened the chest!');
    } catch (err) {
      bot.chat('Failed to open the chest!');
      return;
    }

    // Withdraw all iron pickaxes and torches
    let found = false;
    let foundTorch = false;
    for (const slot of chest.containerItems()) {
      if (slot.type === pickaxeId) {
        found = true;
        try {
          await chest.withdraw(slot.type, null, slot.count);
          bot.chat(`Withdrew ${slot.count} iron pickaxe(s).`);
        } catch (err) {
          bot.chat(`Failed to withdraw pickaxes: ${err.message}`);
        }
      }
      if (slot.type === torchId) {
        foundTorch = true;
        try {
          await chest.withdraw(slot.type, null, slot.count);
          bot.chat(`Withdrew ${slot.count} torch(es).`);
        } catch (err) {
          bot.chat(`Failed to withdraw torches: ${err.message}`);
        }
      }
    }
    if (!found) {
      bot.chat('No iron pickaxes found in chest.');
    }
    if (!foundTorch) {
      bot.chat('No torches found in chest.');
    }
    await chest.close();
    bot.chat('Got the goods.');
    // Move 20 blocks in a random direction away from the chest
    await moveRandomlyFromChest(chestBlock.position, 20);
  }

  async function mineStraightDown(blocksToMine) {
    const pickaxe = bot.inventory.items().find(item => item.name === PICKAXE_NAME);
    if (!pickaxe) {
      bot.chat('No iron pickaxe in inventory!');
      return;
    }
    try {
      await bot.equip(pickaxe, 'hand');
      bot.chat('Equipped iron pickaxe!');
    } catch (err) {
      bot.chat('Failed to equip pickaxe!');
      return;
    }
    for (let i = 0; i < blocksToMine; i++) {
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!below || below.name === 'air') {
        bot.chat('No block below to mine!');
        break;
      }
      try {
        await bot.dig(below);
        // Wait for the bot to fall down to the next block
        await bot.waitForTicks(10);
        if (Math.floor(bot.entity.position.y) <= -54) {
          bot.chat('Reached level -54!');
          break;
        }
      } catch (err) {
        bot.chat(`Failed to mine block: ${err.message}`);
        break;
      }
    }
  }

  async function stripMineUntilDiamonds() {
    const mcData = require('minecraft-data')(bot.version);
    const diamondOreId = mcData.blocksByName.diamond_ore.id;
    bot.chat('Starting strip mining for diamonds...');
    let foundDiamonds = false;
    let blocksMined = 0;
    while (!foundDiamonds) {
      // Check all adjacent blocks for diamond ore
      const pos = bot.entity.position;
      const directions = [
        { x: 1, y: 0, z: 0 },   // Front (positive X)
        { x: 0, y: 0, z: -1 },  // Left (negative Z)
        { x: 0, y: 0, z: 1 },   // Right (positive Z)
        { x: 0, y: 1, z: 0 },   // Up
        { x: 0, y: -1, z: 0 },  // Down
      ];
      let diamondBlock = null;
      for (const dir of directions) {
        const checkPos = pos.offset(dir.x, dir.y, dir.z);
        const block = bot.blockAt(checkPos);
        if (block && block.type === diamondOreId) {
          diamondBlock = block;
          break;
        }
      }
      if (diamondBlock) {
        bot.chat('Diamond ore found! Mining...');
        await mineConnectedDiamonds(diamondBlock.position, diamondOreId, new Set());
        foundDiamonds = true;
        bot.chat('All connected diamond ore mined!');
        break;
      }
      // If not diamond, mine the block in front
      const forward = pos.offset(1, 0, 0);
      const block = bot.blockAt(forward);
      if (block && block.name !== 'air') {
        try {
          await bot.dig(block);
          blocksMined++;
        } catch (err) {
          bot.chat(`Failed to dig strip mine block: ${err.message}`);
          break;
        }
      }
      // Move forward
      await bot.pathfinder.goto(new goals.GoalBlock(
        Math.floor(forward.x),
        Math.floor(forward.y),
        Math.floor(forward.z)
      ));
      await bot.waitForTicks(5);
      // Place a torch every 10 blocks
      if (blocksMined > 0 && blocksMined % 10 === 0) {
        await placeTorch();
      }
    }
  }

  async function mineConnectedDiamonds(pos, diamondOreId, visited) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (visited.has(key)) return;
    visited.add(key);
    const block = bot.blockAt(pos);
    if (!block || block.type !== diamondOreId) return;
    try {
      await bot.dig(block);
      await bot.waitForTicks(5);
    } catch (err) {
      bot.chat(`Failed to dig diamond ore: ${err.message}`);
      return;
    }
    // Check all 6 directions for more diamond ore
    const directions = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
    for (const dir of directions) {
      const nextPos = pos.offset(dir.x, dir.y, dir.z);
      await mineConnectedDiamonds(nextPos, diamondOreId, visited);
    }
  }

  async function placeTorch() {
    const torch = bot.inventory.items().find(item => item.name === TORCH_NAME);
    if (!torch) {
      bot.chat('No torches left to place!');
      return;
    }
    try {
      await bot.equip(torch, 'hand');
      // Place torch at feet (on the floor)
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (below && bot.canPlaceBlock(below)) {
        await bot.placeBlock(below, { x: 0, y: 1, z: 0 });
        bot.chat('Placed a torch.');
      } else {
        bot.chat('Cannot place torch here.');
      }
    } catch (err) {
      bot.chat(`Failed to place torch: ${err.message}`);
    }
  }

  async function moveRandomlyFromChest(startPos, distance) {
    // Pick a random direction: N, S, E, or W
    const directions = [
      { x: 1, z: 0 },   // East
      { x: -1, z: 0 },  // West
      { x: 0, z: 1 },   // South
      { x: 0, z: -1 },  // North
    ];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const targetX = startPos.x + dir.x * distance;
    const targetZ = startPos.z + dir.z * distance;
    const targetY = startPos.y;
    bot.chat(`Moving ${distance} blocks away from chest...`);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(targetX, targetY, targetZ, 1));
      bot.chat('Arrived at random mining location.');
    } catch (err) {
      bot.chat(`Failed to move to mining location: ${err.message}`);
    }
  }

  async function moveRandomlyExploring(minDist, maxDist) {
    // Pick a random direction: N, S, E, or W
    const directions = [
      { x: 1, z: 0 },   // East
      { x: -1, z: 0 },  // West
      { x: 0, z: 1 },   // South
      { x: 0, z: -1 },  // North
    ];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    const dist = Math.floor(Math.random() * (maxDist - minDist + 1)) + minDist;
    const pos = bot.entity.position;
    const targetX = pos.x + dir.x * dist;
    const targetZ = pos.z + dir.z * dist;
    const targetY = pos.y;
    bot.chat(`Exploring: moving ${dist} blocks in a random direction...`);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(targetX, targetY, targetZ, 1));
      bot.chat('Exploration move complete. Searching again...');
    } catch (err) {
      bot.chat(`Failed to move while exploring: ${err.message}`);
    }
  }
});
