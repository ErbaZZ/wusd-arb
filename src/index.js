require('dotenv').config();

import Web3 from 'web3';
import axios from 'axios';
import ERC20 from './abi/ERC20.json';
import Pair from './abi/Pair.json';
import ContractAddress from './ContractAddress.json';
import WUSDArbPoly from './abi/WUSDArbPoly.json';
import WUSDMaster from './abi/WUSDMaster.json';

import { getAmountOut, getAmountsOut } from './modules/price_helper.js';

// ====== ENV ======

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GAS_BASE = process.env.GAS_BASE;
const GAS_LIMIT = process.env.GAS_LIMIT;
const LINE_NOTI_TOKEN = process.env.LINE_NOTI_TOKEN;
const CLAIM = process.env.CLAIM;

// ==== Notifications ====

const LINE_NOTI_CONFIG = { headers: { Authorization: `Bearer ${LINE_NOTI_TOKEN}` } };
const LINE_NOTI_URL = 'https://notify-api.line.me/api/notify';

// ====== CONSTANTS ======

const BN = Web3.utils.BN;

// ====== CONNECTION ======

const provider = new Web3.providers.WebsocketProvider(RPC_URL, {
    clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000,
        maxReceivedFrameSize: 2000000, // bytes - default: 1MiB, current: 2MiB
        maxReceivedMessageSize: 10000000, // bytes - default: 8MiB, current: 10Mib
    },
    reconnect: {
        auto: true,
        delay: 12000,
        onTimeout: true,
        maxAttempts: 10
    }
});

const web3 = new Web3(provider);
const account = web3.eth.accounts.wallet.add(PRIVATE_KEY);
provider.on('connect', () => {
    console.log("Connected!");
});
provider.on('error', err => {
    console.log(`WSS Error: ${err.message}`);
});
provider.on('end', async (err) => {
    console.log(`WSS Connection Stopped!`);
});

// ====== CONTRACTS ======

const usdcwusdPair = new web3.eth.Contract(Pair, ContractAddress["USDCWUSDLP"]);
const usdcwexpolyPair = new web3.eth.Contract(Pair, ContractAddress["USDCWEXPolyLP"]);
const wusd = new web3.eth.Contract(ERC20, ContractAddress["WUSD"]);
const usdc = new web3.eth.Contract(ERC20, ContractAddress["USDC"]);
const wexpoly = new web3.eth.Contract(ERC20, ContractAddress["WEXPoly"]);
const wusdArb = new web3.eth.Contract(WUSDArbPoly, ContractAddress["WUSDArbPoly"]);
const wusdMaster = new web3.eth.Contract(WUSDMaster, ContractAddress["WUSDMaster"]);

// ====== VARIABLES ======

let currentBlock = 0;
let isTransactionOngoing = false;
let lastProfit;

// ====== FUNCTIONS ======

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const sendLineNotification = async (message) => {
    return axios.post(LINE_NOTI_URL, `message=${encodeURIComponent(message)}`, LINE_NOTI_CONFIG);
};

const swapAndRedeem = async (usdcAmount, minWusdAmount, txConfig) => {
    return wusdArb.methods.swapAndRedeem(usdcAmount, minWusdAmount).send(txConfig)
        .on('transactionHash', function (transactionHash) {
            console.log(`Swapping and Redeeming: ${transactionHash} (${web3.utils.fromWei(txConfig.gasPrice, 'Gwei')} gwei)`);
        }).on('receipt', (receipt) => {
            console.log("Swapping and Redeeming Success!");
        })
};

const claim = async (minUsdc, txConfig) => {
    return wusdArb.methods.claim(minUsdc).send(txConfig)
        .on('transactionHash', function (transactionHash) {
            console.log(`Claiming: ${transactionHash} (${web3.utils.fromWei(txConfig.gasPrice, 'Gwei')} gwei)`);
        }).on('receipt', (receipt) => {
            console.log("Claiming Success!");
        })
};

const fetchInfo = async () => {
    const gasPrice = web3.eth.getGasPrice();
    const nonce = web3.eth.getTransactionCount(account.address, "pending");
    const usdcBalance = usdc.methods.balanceOf(account.address).call();
    const wusdSupply = wusd.methods.totalSupply().call();
    const wexpolyBalance = wexpoly.methods.balanceOf(ContractAddress["WUSDMaster"]).call();
    const usdcwusdReserves = usdcwusdPair.methods.getReserves().call();
    const usdcwexpolyReserves = usdcwexpolyPair.methods.getReserves().call();
    return {
        gasPrice: new BN(await gasPrice).add(new BN(5000000000)),
        nonce: await nonce,
        usdcBalance: new BN(await usdcBalance),
        wusdSupply: new BN(await wusdSupply),
        wexpolyBalance: new BN(await wexpolyBalance),
        usdcwusdReserves: await usdcwusdReserves,
        usdcwexpolyReserves: await usdcwexpolyReserves
    };
};

const getMostProfitableAmount = (info) => {
    // Starts with USDC
    let middlePoint = info.usdcBalance.div(new BN(2));

    let usdcToSwap = new BN(0);
    let limitL = new BN(0);
    let limitR = info.usdcBalance;
    let profit = 0;
    let usdcFromRedeem = 0;
    let wusdAmount = 0;

    // USDC -> WUSD Wault
    const reservesArray = [[info.usdcwusdReserves[0], info.usdcwusdReserves[1]]];

    // Divide in half and search for increasing profit
    do {
        const usdcToSwapL = limitL.add(middlePoint).div(new BN(2));
        const wusdAmountL = getAmountsOut(usdcToSwapL, 9980, reservesArray).slice(-1)[0];
        const wexToSwapL = info.wexpolyBalance.mul(wusdAmountL).div(info.wusdSupply);
        const usdcFromWexL = getAmountOut(wexToSwapL, 9980, info.usdcwexpolyReserves[1], info.usdcwexpolyReserves[0]);
        const usdcFromRedeemL = wusdAmountL.mul(new BN(895)).div(new BN(1000000000000000)).add(usdcFromWexL);
        const profitL = usdcFromRedeemL.sub(usdcToSwapL);

        const usdcToSwapR = middlePoint.add(limitR).div(new BN(2));
        const wusdAmountR = getAmountsOut(usdcToSwapR, 9980, reservesArray).slice(-1)[0];
        const wexToSwapR = info.wexpolyBalance.mul(wusdAmountR).div(info.wusdSupply);
        const usdcFromWexR = getAmountOut(wexToSwapR, 9980, info.usdcwexpolyReserves[1], info.usdcwexpolyReserves[0]);
        const usdcFromRedeemR = wusdAmountR.mul(new BN(895)).div(new BN(1000000000000000)).add(usdcFromWexR);
        const profitR = usdcFromRedeemR.sub(usdcToSwapR);

        if (profitL.gt(profitR)) {
            usdcToSwap = usdcToSwapL;
            limitR = middlePoint;
            middlePoint = limitL.add(limitR).div(new BN(2));
            profit = profitL;
            usdcFromRedeem = usdcFromRedeemL;
            wusdAmount = wusdAmountL;
        } else {
            usdcToSwap = usdcToSwapR;
            limitL = middlePoint;
            middlePoint = limitL.add(limitR).div(new BN(2));
            profit = profitR;
            usdcFromRedeem = usdcFromRedeemR;
            wusdAmount = wusdAmountR;
        }
    } while (parseFloat(web3.utils.fromWei(limitR.sub(limitL).abs(), 'mwei')).toFixed(4) > 0.5);
    return { "amount": usdcToSwap, "wusdAmount": wusdAmount, "redeem": usdcFromRedeem, "profit": profit };
};

async function main() {
    sendLineNotification(`Starting...`);
    const blockSubscription = web3.eth.subscribe('newBlockHeaders');
    // const pendingSubscription = web3.eth.subscribe('pendingTransactions');

    const pendingClaim = await wusdMaster.methods.usdcClaimAmount(ContractAddress["WUSDArbPoly"]).call();

    if (pendingClaim !== "0") {
        const gasPrice = new BN(await web3.eth.getGasPrice());
        const usdcBalance = usdc.methods.balanceOf(account.address).call();
        const masterUsdcBalance = usdc.methods.balanceOf(ContractAddress['WUSDMaster']).call();

        const balances = {
            usdc: new BN(await usdcBalance),
            masterUsdc: new BN(await masterUsdcBalance)
        }
        if (balances.masterUsdc.lt(new BN(pendingClaim))) {
            sendLineNotification(`🟪❌ Insufficient USDC Balance in WUSDMaster, waiting...`);
            while(balances.masterUsdc.lt(new BN(pendingClaim))) {
                await sleep(2000);
                balances.masterUsdc = new BN(await usdc.methods.balanceOf(ContractAddress['WUSDMaster']).call());
            }
        }
        await claim("0", {
            gasPrice: gasPrice.add(new BN(10000000001)),
            gas: GAS_LIMIT,
            from: account.address
        });
        const afterUsdcBalance = new BN(await usdc.methods.balanceOf(account.address).call());
        const actualProfit = afterUsdcBalance.sub(balances.usdc);
        console.log(`Claimed:\t${parseFloat(web3.utils.fromWei(actualProfit, 'mwei')).toFixed(4)} USDC (${web3.utils.fromWei(gasPrice.add(new BN(10000000001)), 'Gwei')} gwei)`);
        sendLineNotification(`🟪✅ Claimed:\t${parseFloat(web3.utils.fromWei(actualProfit, 'ether')).toFixed(4)} USDC\nBalance: ${parseFloat(web3.utils.fromWei(afterUsdcBalance, 'ether')).toFixed(4)} USDC`);
        if (CLAIM) process.exit(0);
    }

    blockSubscription.on('data', async (block, error) => {
        currentBlock = block.number;

        // Skip on redeeming
        if (isTransactionOngoing) return;

        const info = await fetchInfo();

        // Check USDC Balance
        if (info.usdcBalance.lte(new BN(0))) return;

        // Quote USDC to WUSD from redeem
        const profitableAmount = getMostProfitableAmount(info);

        const profitFlat = parseFloat(web3.utils.fromWei(profitableAmount.profit, 'mwei')).toFixed(4);

        if (lastProfit !== profitFlat) {
            console.log(`${new Date().toLocaleString()}, Block: ${currentBlock}, Balance: ${parseFloat(web3.utils.fromWei(info.usdcBalance, 'mwei')).toFixed(4)} USDC, Amount: ${parseFloat(web3.utils.fromWei(profitableAmount.amount, 'mwei')).toFixed(4)} USDC, Redeem: ${parseFloat(web3.utils.fromWei(profitableAmount.redeem, 'mwei')).toFixed(4)} USDC, Profit: ${profitFlat} USDC`);
            lastProfit = profitFlat;
        }

        if (profitFlat < 0.5) return;

        sendLineNotification(`🟪 ${profitFlat} USDC\n${parseFloat(web3.utils.fromWei(profitableAmount.amount, 'mwei')).toFixed(4)} -> ${parseFloat(web3.utils.fromWei(profitableAmount.redeem, 'mwei')).toFixed(4)} USDC`);

        isTransactionOngoing = true;

        const sendTxBlock = currentBlock;

        let txConfig = {
            gasPrice: info.gasPrice.add(new BN(5000000001)),
            gas: GAS_LIMIT,
            from: account.address,
            nonce: info.nonce
        };

        try {
            swapAndRedeem(profitableAmount.amount, profitableAmount.wusdAmount.mul(new BN(99)).div(new BN(100)), txConfig);
        } catch (e) {
            isTransactionOngoing = false;
            return;
        }

        txConfig = {
            gasPrice: info.gasPrice.add(new BN(5000000001)),
            gas: GAS_LIMIT,
            from: account.address,
            nonce: info.nonce + 1
        };

        while (currentBlock <= sendTxBlock) {
            await sleep(10);
        }
        try {
            await claim("0", txConfig);
        } catch (e) {
            console.log("Claim Failed, Retrying...");
            txConfig = {
                gasPrice: info.gasPrice.add(new BN(5000000001)),
                gas: GAS_LIMIT,
                from: account.address,
                nonce: info.nonce + 2
            };    
            await claim("0", txConfig);
        }

        isTransactionOngoing = false;

        const afterusdcBalance = new BN(await usdc.methods.balanceOf(account.address).call());

        if (afterusdcBalance.lt(info.usdcBalance)) {
            sendLineNotification(`🟪❌ Balance: ${parseFloat(web3.utils.fromWei(afterusdcBalance, 'mwei')).toFixed(4)} USDC`);
            console.warn("Bad Redeem!");
            return;
        }

        const actualProfit = afterusdcBalance.sub(info.usdcBalance);
        const actualProfitPercent = actualProfit.mul(new BN(10000)).div(profitableAmount.amount).toNumber();
        console.log(`Actual Profit:\t${parseFloat(web3.utils.fromWei(actualProfit, 'mwei')).toFixed(4)} USDC (${actualProfitPercent / 100}%)`);
        sendLineNotification(`🟪✅ ${parseFloat(web3.utils.fromWei(actualProfit, 'mwei')).toFixed(4)} USDC (${actualProfitPercent / 100}%)\nBalance: ${parseFloat(web3.utils.fromWei(afterusdcBalance, 'mwei')).toFixed(4)} USDC`);
    }).on("error", (err) => {
        console.error(err.message);
        isTransactionOngoing = false;
    });
}

main().then(async () => {
    // do nothing
}).catch((err) => {
    console.error(err);
    process.exit(1337);
});
