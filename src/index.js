require('dotenv').config();

import Web3 from 'web3';
import axios from 'axios';
import ERC20 from './abi/ERC20.json';
import Pair from './abi/Pair.json';
import WUSDMaster from './abi/WUSDMaster.json';
import StableSwap from './abi/StableSwap.json';
import Router from './abi/Router.json';
import ContractAddress from './ContractAddress.json';
import { getAmountOut, getAmountsOut } from './modules/price_helper.js';

// ====== ENV ======

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GAS_BASE = process.env.GAS_BASE;
const GAS_LIMIT = process.env.GAS_LIMIT;
const LINE_NOTI_TOKEN = process.env.LINE_NOTI_TOKEN;

// ==== Notifications ====

const LINE_NOTI_CONFIG = { headers: { Authorization: `Bearer ${LINE_NOTI_TOKEN}` } };
const LINE_NOTI_URL = 'https://notify-api.line.me/api/notify';

// ====== CONSTANTS ======

const BN = Web3.utils.BN;
const PATH_USDT_BUSD_WUSD = [ContractAddress["USDT"], ContractAddress["BUSD"], ContractAddress["WUSD"]];
const PATH_BUSD_WUSD = [ContractAddress["BUSD"], ContractAddress["WUSD"]];
const PATH_WEX_USDT = [ContractAddress["WEX"], ContractAddress["USDT"]];

// ====== CONNECTION ======

const provider = new Web3.providers.WebsocketProvider(RPC_URL, {
    clientConfig: {
        keepalive: true,
        keepaliveInterval: 60000,
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

const wusdMaster = new web3.eth.Contract(WUSDMaster, ContractAddress["WUSDMaster"]);
const waultRouter = new web3.eth.Contract(Router, ContractAddress["WaultSwapRouter"]);
const usdtbusdPair = new web3.eth.Contract(Pair, ContractAddress["USDTBUSDLP"]);
const wusdbusdPair = new web3.eth.Contract(Pair, ContractAddress["WUSDBUSDLP"]);
const usdtwexPair = new web3.eth.Contract(Pair, ContractAddress["USDTWEXLP"]);
const busd = new web3.eth.Contract(ERC20, ContractAddress["BUSD"]);
const wusd = new web3.eth.Contract(ERC20, ContractAddress["WUSD"]);
const usdt = new web3.eth.Contract(ERC20, ContractAddress["USDT"]);
const wex = new web3.eth.Contract(ERC20, ContractAddress["WEX"]);
const stableSwap = new web3.eth.Contract(StableSwap, ContractAddress["StableSwap"]);

// ====== VARIABLES ======

let currentBlock = 0;
let isTransactionOngoing = false;

// ====== FUNCTIONS ======

const sendLineNotification = async (message) => {
	return axios.post(LINE_NOTI_URL, `message=${encodeURIComponent(message)}`, LINE_NOTI_CONFIG);
}

const swapToken = async (routerContract, amountIn, amountOutMin, path, gasPrice) => {
    await routerContract.methods.swapExactTokensForTokens(amountIn, amountOutMin, path, account.address, Math.floor(Date.now() / 1000) + 60).send({
        gasPrice: gasPrice.toString(),
        gas: GAS_LIMIT,
        from: account.address
    }).on('transactionHash', function (transactionHash) {
        console.log(`Swapping Token: ${transactionHash} (${web3.utils.fromWei(gasPrice, 'gwei')} Gwei)`);
    }).on('receipt', (receipt) => {
        console.log("Token Swapping Success!");
    }).on('error', (err) => {
        throw err;
    });
};

const redeem = async (wusdAmount, gasPrice) => {
    await wusdMaster.methods.redeem(wusdAmount).send({
        gasPrice: gasPrice.toString(),
        gas: GAS_LIMIT,
        from: account.address
    }).on('transactionHash', function (transactionHash) {
        console.log(`Redeeming: ${transactionHash} (${web3.utils.fromWei(wusdAmount, 'ether')} WUSD)`);
    }).on('receipt', (receipt) => {
        console.log("Token Redeeming Success!");
    }).on('error', (err) => {
        throw err;
    });
};

const claimUsdt = async (minUSDT, gasPrice) => {
    await wusdMaster.methods.claimUsdt(minUSDT).send({
        gasPrice: gasPrice.toString(),
        gas: GAS_LIMIT,
        from: account.address
    }).on('transactionHash', function (transactionHash) {
        console.log(`Claiming: ${transactionHash}`);
    }).on('receipt', (receipt) => {
        console.log("Token Claiming Success!");
    }).on('error', (err) => {
        throw err;
    });
};

// id: 0 = BUSD, 1 = USDT
const stableSwapExchange = async (fromId, toId, amountIn, amountOutMin, gasPrice) => {
    await stableSwap.methods.exchange(fromId, toId, amountIn, amountOutMin).send({
        gasPrice: gasPrice.toString(),
        gas: GAS_LIMIT,
        from: account.address
    }).on('transactionHash', function (transactionHash) {
        console.log(`Swapping: ${transactionHash}`);
    }).on('receipt', (receipt) => {
        console.log("Swapping Success!");
    }).on('error', (err) => {
        throw err;
    });
}

const fetchInfo = async() => {
    const busdBalance = busd.methods.balanceOf(account.address).call();
    const usdtBalance = usdt.methods.balanceOf(account.address).call();
    const wusdSupply = wusd.methods.totalSupply().call();
    const wexBalance = wex.methods.balanceOf(ContractAddress["WUSDMaster"]).call();
    const usdtbusdReserves = usdtbusdPair.methods.getReserves().call();
    const wusdbusdReserves = wusdbusdPair.methods.getReserves().call();
    const usdtwexReserves = usdtwexPair.methods.getReserves().call();
    return {
        busdBalance: new BN(await busdBalance),
        usdtBalance: new BN(await usdtBalance),
        wusdSupply: new BN(await wusdSupply),
        wexBalance: new BN(await wexBalance),
        usdtbusdReserves: await usdtbusdReserves,
        wusdbusdReserves: await wusdbusdReserves,
        usdtwexReserves: await usdtwexReserves
    }
}

const getMostProfitableAmount = (info) => {
    // Starts with USDT
    // let middlePoint = info.usdtBalance.div(new BN(2));
    
    // Starts with BUSD
    let middlePoint = info.busdBalance.div(new BN(2));

    let busdToSwap = new BN(0);
    let limitL = new BN(0);
    let limitR = info.busdBalance;
    let profit = new BN(0);
    let usdtFromRedeem = 0;
    let wusdAmount = 0;

    // USDT -> BUSD -> WUSD Wault
    // const reservesArray = [[info.usdtbusdReserves[0], info.usdtbusdReserves[1]], [info.wusdbusdReserves[1], info.wusdbusdReserves[0]]];

    // BUSD -> WUSD Wault
    const reservesArray = [[info.wusdbusdReserves[1], info.wusdbusdReserves[0]]];

    // Divide in half and search for increasing profit
    do {
        const busdToSwapL = limitL.add(middlePoint).div(new BN(2));
        const wusdAmountL = getAmountsOut(busdToSwapL, 9980, reservesArray).slice(-1)[0];
        const wexToSwapL = info.wexBalance.mul(wusdAmountL).div(info.wusdSupply);
        const usdtFromWexL = getAmountOut(wexToSwapL, 9980, info.usdtwexReserves[1], info.usdtwexReserves[0]);
        const usdtFromRedeemL = wusdAmountL.mul(new BN(895)).div(new BN(1000)).add(usdtFromWexL);
        // Ignore price impact from USDT -> BUSD
        const profitL = usdtFromRedeemL.sub(busdToSwapL);
       
        const busdToSwapR = middlePoint.add(limitR).div(new BN(2));
        const wusdAmountR = getAmountsOut(busdToSwapR, 9980, reservesArray).slice(-1)[0];
        const wexToSwapR = info.wexBalance.mul(wusdAmountR).div(info.wusdSupply);
        const usdtFromWexR = getAmountOut(wexToSwapR, 9980, info.usdtwexReserves[1], info.usdtwexReserves[0]);
        const usdtFromRedeemR = wusdAmountR.mul(new BN(895)).div(new BN(1000)).add(usdtFromWexR);
        // Ignore price impact from USDT -> BUSD
        const profitR = usdtFromRedeemR.sub(busdToSwapR);

        if (profitL.gt(profitR)) {
            busdToSwap = busdToSwapL
            limitR = middlePoint;
            middlePoint = limitL.add(limitR).div(new BN(2));
            profit = profitL;
            usdtFromRedeem = usdtFromRedeemL;
            wusdAmount = wusdAmountL;
        } else {
            busdToSwap = busdToSwapR;
            limitL = middlePoint;
            middlePoint = limitL.add(limitR).div(new BN(2));
            profit = profitR;
            usdtFromRedeem = usdtFromRedeemR;
            wusdAmount = wusdAmountR;
        }
        // console.log({usdtToSwap: parseFloat(web3.utils.fromWei(usdtToSwap, 'ether')).toFixed(4), profit: parseFloat(web3.utils.fromWei(profit, 'ether')).toFixed(4)})
    } while (parseFloat(web3.utils.fromWei(limitR.sub(limitL).abs(), 'ether')).toFixed(4) > 0.5)
    return { "amount": busdToSwap, "wusdAmount": wusdAmount, "redeem": usdtFromRedeem, "profit": profit }
}

async function main() {
	const blockSubscription = web3.eth.subscribe('newBlockHeaders');
    // const pendingSubscription = web3.eth.subscribe('pendingTransactions');

    blockSubscription.on('data', async (block, error) => {
        // Skip on redeeming
        if (isTransactionOngoing) return;

        currentBlock = block.number;
        const info = await fetchInfo();

        // Check USDT Balance
        if (info.busdBalance.lte(new BN(0))) return;
        
        // Quote USDT to WUSD from redeem
        const profitableAmount = getMostProfitableAmount(info)
        
        const profitFlat = parseFloat(web3.utils.fromWei(profitableAmount.profit, 'ether')).toFixed(4);

        console.log(`${new Date().toLocaleString()}, Block: ${currentBlock}, Balance: ${parseFloat(web3.utils.fromWei(info.busdBalance, 'ether')).toFixed(4)} BUSD, Amount: ${parseFloat(web3.utils.fromWei(profitableAmount.amount, 'ether')).toFixed(4)} BUSD, Redeem: ${parseFloat(web3.utils.fromWei(profitableAmount.redeem, 'ether')).toFixed(4)} BUSD, Profit: ${profitFlat} BUSD`);

        if (profitFlat < 2) return;

        sendLineNotification(`\n${parseFloat(web3.utils.fromWei(profitableAmount.amount, 'ether')).toFixed(4)} -> ${parseFloat(web3.utils.fromWei(profitableAmount.redeem, 'ether')).toFixed(4)} BUSD\nProfit: ${profitFlat}`);

        isTransactionOngoing = true;

        await swapToken(waultRouter, profitableAmount.amount, profitableAmount.wusdAmount.mul(new BN(99)).div(new BN(100)), PATH_BUSD_WUSD, GAS_BASE);
        const wusdBalance = new BN(await wusd.methods.balanceOf(account.address).call());
        await redeem(wusdBalance, GAS_BASE);
        await claimUsdt("0", GAS_BASE);
        const afterUsdtBalance = new BN(await usdt.methods.balanceOf(account.address).call());
        await stableSwapExchange(1, 0, afterUsdtBalance, afterUsdtBalance.mul(new BN(999)).div(new BN(1000)), GAS_BASE);
        isTransactionOngoing = false;

        const afterBusdBalance = new BN(await busd.methods.balanceOf(account.address).call());

        if (afterBusdBalance.lt(info.busdBalance)) {
            sendLineNotification(`BAD:\nBalance: ${parseFloat(web3.utils.fromWei(afterBusdBalance, 'ether')).toFixed(4)} BUSD`);
            console.warn("Bad Redeem!");
            return;
        }

        const actualProfit = afterBusdBalance.sub(info.busdBalance);
        const actualProfitPercent = actualProfit.mul(new BN(10000)).div(profitableAmount.amount).toNumber();
        console.log(`Actual Profit:\t${parseFloat(web3.utils.fromWei(actualProfit, 'ether')).toFixed(4)} BUSD (${actualProfitPercent/100}%)`);
        sendLineNotification(`SUCCESS:\n${parseFloat(web3.utils.fromWei(actualProfit, 'ether')).toFixed(4)} BUSD (${actualProfitPercent/100}%)\nBalance: ${parseFloat(web3.utils.fromWei(afterBusdBalance, 'ether')).toFixed(4)} BUSD`);
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
