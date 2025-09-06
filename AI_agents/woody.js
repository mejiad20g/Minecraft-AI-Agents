const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlockPlugin = require('mineflayer-collectblock').plugin;

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Woody',
  version: '1.20.4',
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(collectBlockPlugin);

bot.once('spawn', async () => {
  console.log('Bot spawned!');
  const mcData = require('minecraft-data')(bot.version);

  const collectMove = new Movements(bot, mcData);
  collectMove.canDig = true;

  const safeMove = new Movements(bot, mcData);
  safeMove.canDig = false;

  bot.pathfinder.setMovements(collectMove);

  // IDs for log blocks and items
  const blockLogIds = [
    mcData.blocksByName.oak_log.id,
    mcData.blocksByName.birch_log?.id,
    mcData.blocksByName.spruce_log?.id,
  ].filter(Boolean);
  const itemLogIds = [
    mcData.itemsByName.oak_log.id,
    mcData.itemsByName.birch_log?.id,
    mcData.itemsByName.spruce_log?.id,
  ].filter(Boolean);

  // IDs for all chest variants
  const chestBlockIds = Object.values(mcData.blocksByName)
    .filter(b => b.name.endsWith('_chest'))
    .map(b => b.id);

  function countLogs() {
    return bot.inventory.items()
      .filter(item => itemLogIds.includes(item.type))
      .reduce((sum, item) => sum + item.count, 0);
  }

  async function collectWood(requiredCount) {
    // ensure digging is enabled
    bot.pathfinder.setMovements(collectMove);

    while (countLogs() < requiredCount) {
      const tree = bot.findBlock({ matching: blockLogIds, maxDistance: 64 });
      if (!tree) {
        bot.chat('Looking for trees…');
        await bot.waitForTicks(20);
        continue;
      }
      console.log(`Tree at ${tree.position} – have ${countLogs()}/${requiredCount} logs`);
      try {
        await bot.collectBlock.collect(tree);
        bot.chat('Collected a log');
      } catch (err) {
        console.error('Error collecting log:', err.message);
        bot.chat(`Error harvesting log: ${err.message}`);
        await bot.waitForTicks(20);
      }
    }
  }

  async function storeInChest() {
    console.log('Searching for any chest…');
    const chestBlock = bot.findBlock({ matching: chestBlockIds, maxDistance: 64 });
    if (!chestBlock) {
      bot.chat('…no chest found, retrying in 2s');
      await bot.waitForTicks(40);
      return storeInChest();
    }

    // switch to safe navigation (no digging)
    bot.pathfinder.setMovements(safeMove);

    const chestName = chestBlock.name;
    console.log(`Found ${chestName} at ${chestBlock.position}, navigating…`);
    await bot.pathfinder.goto(new goals.GoalBlock(
      chestBlock.position.x,
      chestBlock.position.y,
      chestBlock.position.z
    ));
    await bot.waitForTicks(20);

    const chest = await bot.openChest(chestBlock);
    bot.chat(`📦 Opened ${chestName}, depositing logs…`);
    for (const log of bot.inventory.items().filter(i => itemLogIds.includes(i.type))) {
      try {
        await chest.deposit(log.type, null, log.count);
        bot.chat(`→ Deposited ${log.count} ${log.name}`);
      } catch (err) {
        bot.chat(`✖ Failed to deposit ${log.name}: ${err.message}`);
      }
    }
    await chest.close();
  }

  async function loopCollectAndStore() {
    while (true) {
      try {
        bot.chat('🔄 Starting collection cycle');
        await collectWood(4);
        bot.chat('✅ Collected 4 logs—heading to chest');
        await storeInChest();
        bot.chat('🏁 Cycle complete—waiting before next run');
        await bot.waitForTicks(40);
      } catch (err) {
        console.error('Unexpected error in loop:', err);
        bot.chat(`⚠ Cycle error: ${err.message}`);
        await bot.waitForTicks(40);
      }
    }
  }

  loopCollectAndStore();
});

// debug
bot.on('end', () => console.log('Bot disconnected (end)'));
bot.on('kicked', reason => console.log('Bot was kicked:', reason));
bot.on('error', err => console.error('Bot encountered error:', err));
