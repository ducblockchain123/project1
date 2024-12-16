const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const colors = require("colors");
const cliProgress = require("cli-progress");

console.clear();

const config = JSON.parse(fs.readFileSync("config.json", "utf8"));
const rpcData = JSON.parse(fs.readFileSync("rpc.json", "utf8"));
const chainConfig = rpcData[config.chain];

if (!chainConfig) {
  console.error(`Không tìm thấy cấu hình cho chain ${config.chain}!`.red);
  process.exit(1);
}

const rpcUrl = chainConfig.rpc;
const wethAbi = chainConfig.wethAbi;
const wethAddress = chainConfig.wethAddress;

const logFile = path.join(__dirname, "transaction_log.json");

function writeLog(data) {
  const logs = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : [];
  logs.push(data);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}

function readLogs(days) {
  if (!fs.existsSync(logFile)) return [];
  const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const recentLogs = logs.filter(log => new Date(log.timestamp).getTime() >= cutoff);

  const oldestLogTime = logs.length > 0 ? new Date(logs[0].timestamp).getTime() : 0;
  if (Date.now() - oldestLogTime > 30 * 24 * 60 * 60 * 1000) {
    fs.writeFileSync(logFile, JSON.stringify([], null, 2));
    return [];
  }

  return recentLogs;
}

function showStatistics(walletAddress) {
  const todayLogs = readLogs(1);
  const last7DaysLogs = readLogs(7);
  const last30DaysLogs = readLogs(30);

  console.log(`Ví: ${walletAddress}`.cyan);
  console.log("-------------------------- Thống kê giao dịch --------------------------".bold);
  console.log(`Hôm nay: ${todayLogs.length} giao dịch`.green);
  console.log(`7 ngày qua: ${last7DaysLogs.length} giao dịch`.yellow);
  console.log(`30 ngày qua: ${last30DaysLogs.length} giao dịch`.magenta);
  console.log(`------------------------------------------------------------------------`.bold);
}

async function wrapETH(wallet, amountInETH) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(wallet, provider);
    const wethContract = new ethers.Contract(wethAddress, wethAbi, signer);

    const amountInWei = ethers.parseEther(amountInETH.toString());
    const formattedAmountWithDecimals = parseFloat(ethers.formatEther(amountInWei)).toFixed(8);
    const tx = await wethContract.deposit({ value: amountInWei });
    console.log(`Transaction sent! Hash: ${tx.hash}`.green);
    writeLog({ action: "Wrap", amount: formattedAmountWithDecimals, wallet, txHash: tx.hash, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(`Error wrapping ETH: ${error.message}`.red);
  }
}

async function unwrapWETH(wallet, amountInWETH) {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(wallet, provider);
    const wethContract = new ethers.Contract(wethAddress, wethAbi, signer);

    const amountInWei = ethers.parseEther(amountInWETH.toString());
    const formattedAmountWithDecimals = parseFloat(ethers.formatEther(amountInWei)).toFixed(8);
    const tx = await wethContract.withdraw(amountInWei);
    console.log(`Transaction sent! Hash: ${tx.hash}`.green);
    writeLog({ action: "Unwrap", amount: formattedAmountWithDecimals, wallet, txHash: tx.hash, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error(`Error unwrapping WETH: ${error.message}`.red);
  }
}

async function delayWithProgress(seconds) {
  const progressBar = new cliProgress.SingleBar({
    format: `Đang chờ: [{bar}] {percentage}%`.green,
    barCompleteChar: "■",
    barIncompleteChar: ".",
    hideCursor: true,
    clearOnComplete: true,
  });

  progressBar.start(seconds, 0);

  for (let i = 1; i <= seconds; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    progressBar.update(i);
  }

  progressBar.stop();
}

async function processWallet(privateKey) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = wallet.address;
  showStatistics(walletAddress);

  const transactionsToPerform = Math.floor(
    Math.random() * (config.dailyTransactions.max - config.dailyTransactions.min + 1) + config.dailyTransactions.min
  );

  let wrapCount = 0;
  let unwrapCount = 0;

  for (let i = 0; i < transactionsToPerform; i++) {
    let action;
    if (wrapCount < 1) {
      action = "wrap";
    } else {
      action = "unwrap";
      wrapCount = 0;
      unwrapCount++;
    }

    const amount = (Math.random() * (config.transactionAmount.max - config.transactionAmount.min) + config.transactionAmount.min).toFixed(8);

    if (action === "wrap") {
      const balance = await provider.getBalance(walletAddress);
      if (ethers.formatEther(balance) >= amount) {
        console.log(`Wrapping ${amount} ETH`.blue);
        await wrapETH(privateKey, amount);
        wrapCount++;
      } else {
        console.log(`Không đủ ETH để thực hiện Wrap! Bỏ qua giao dịch Wrap này.`.red);
        continue;
      }
    } else if (action === "unwrap") {
      const wethContract = new ethers.Contract(wethAddress, wethAbi, wallet);
      const wethBalance = await wethContract.balanceOf(walletAddress);
      if (ethers.formatEther(wethBalance) >= amount) {
        console.log(`Unwrapping ${amount} WETH`.blue);
        await unwrapWETH(privateKey, amount);
        unwrapCount++;
      } else {
        console.log(`Không đủ WETH để thực hiện Unwrap! Bỏ qua giao dịch Unwrap này.`.red);
        continue;
      }
    }

    const delay = Math.random() * (config.transactionDelay.max - config.transactionDelay.min) + config.transactionDelay.min;
    const delayInSeconds = Math.floor(delay / 1000);
    console.log(`Chờ ${delayInSeconds} giây trước giao dịch tiếp theo.`.yellow);
    await delayWithProgress(delayInSeconds);
  }
}

async function main() {
  while (true) {
    console.log(`Bắt đầu chu kỳ giao dịch.`.green);

    for (const privateKey of config.privateKeys) {
      await processWallet(privateKey);
    }

    console.log(`Hoàn thành chu kỳ. Chờ 23 tiếng trước khi chạy lại.`.green);

    const TimeSeconds = 23 * 60 * 60;
    await delayWithProgress(TimeSeconds);
  }
}

main();
