require('dotenv').config();

import Web3 from 'web3';
import axios from 'axios';
import ERC20 from './abi/ERC20.json';
import Pair from './abi/Pair.json';
import WUSDMaster from './abi/WUSDMaster.json';
import Router from './abi/Router.json';
import ContractAddress from './ContractAddress.json';

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
const wusd = new web3.eth.Contract(ERC20, ContractAddress["WUSD"]);
const usdt = new web3.eth.Contract(ERC20, ContractAddress["USDT"]);
const wex = new web3.eth.Contract(ERC20, ContractAddress["WEX"]);

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

async function main() {
	const blockSubscription = web3.eth.subscribe('newBlockHeaders');
    // const pendingSubscription = web3.eth.subscribe('pendingTransactions');

    blockSubscription.on('data', async (block, error) => {
        // Skip on redeeming
        if (isTransactionOngoing) return;

        currentBlock = block.number;
        console.log("----");
        console.warn(`${new Date().toLocaleString()}, Block: ${currentBlock}`);

        // Get USDT Balance
        const usdtBalance = new BN(await usdt.methods.balanceOf(account.address).call());
        // const usdtBalance = new BN(web3.utils.toWei("10", 'ether'));

        if (usdtBalance.lte(new BN(0))) return;

        // Get WUSD Reserves/Total Supply
        const wusdSupply = new BN(await wusd.methods.totalSupply().call());
        
        // Get WEX Balance in WUSDMaster
        const wexBalance = new BN(await wex.methods.balanceOf(ContractAddress["WUSDMaster"]).call());

        // Quote USDT to WUSD from redeem
        const wusdSwapAmounts = await waultRouter.methods.getAmountsOut(usdtBalance, PATH_USDT_BUSD_WUSD).call();
        const wusdAmount = new BN(wusdSwapAmounts[wusdSwapAmounts.length - 1]);
        
        const wexToSwap = wexBalance.mul(wusdAmount).div(wusdSupply);
        
        const wexSwapAmounts = await waultRouter.methods.getAmountsOut(wexToSwap, PATH_WEX_USDT).call();
        const usdtFromWex = new BN(wexSwapAmounts[wexSwapAmounts.length - 1]);
        const usdtFromRedeem = wusdAmount.mul(new BN(895)).div(new BN(1000)).add(usdtFromWex);
       
        const profitPercent = usdtFromRedeem.mul(new BN(10000)).div(new BN(usdtBalance)).toNumber() - 10000;

        // Skip on low profit
        if (profitPercent/100 < 0) return;
        
        console.log(`Balance\t: ${parseFloat(web3.utils.fromWei(usdtBalance, 'ether')).toFixed(4)} USDT`);
        console.log(`Redeem\t: ${parseFloat(web3.utils.fromWei(usdtFromRedeem, 'ether')).toFixed(4)} USDT`);
        console.log(`Profit\t: ${profitPercent/100}%`);

        const profitFlat = parseFloat(web3.utils.fromWei(usdtFromRedeem.sub(usdtBalance), 'ether')).toFixed(4);
        
        if (profitFlat < 10) return;

        sendLineNotification(`\n${parseFloat(web3.utils.fromWei(usdtBalance, 'ether')).toFixed(4)} -> ${parseFloat(web3.utils.fromWei(usdtFromRedeem, 'ether')).toFixed(4)} USDT\nProfit: ${profitPercent/100}%`);

        isTransactionOngoing = true;

        await swapToken(waultRouter, usdtBalance, usdtBalance.mul(new BN(99)).div(new BN(100)), PATH_USDT_BUSD_WUSD, GAS_BASE);
        const wusdBalance = new BN(await wusd.methods.balanceOf(account.address).call());
        await redeem(wusdBalance, GAS_BASE);
        await claimUsdt("0", GAS_BASE);
        isTransactionOngoing = false;

        const afterUsdtBalance = new BN(await usdt.methods.balanceOf(account.address).call());

        if (afterUsdtBalance.lt(usdtBalance)) {
            console.warn("Bad Redeem!");
            return;
        }

        const actualProfit = afterUsdtBalance.sub(usdtBalance);
        const actualProfitPercent = actualProfit.mul(new BN(10000)).div(usdtBalance).toNumber();
        console.log(`Actual Profit:\t${parseFloat(web3.utils.fromWei(actualProfit, 'ether')).toFixed(4)} USDT (${actualProfitPercent/100}%)`)
        sendLineNotification(`SUCCESS:\t${parseFloat(web3.utils.fromWei(actualProfit, 'ether')).toFixed(4)} USDT (${actualProfitPercent/100}%)`)
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
