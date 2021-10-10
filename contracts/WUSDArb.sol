//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IWUSDMaster {
    function redeem(uint256 amount) external;

    function claimUsdt(uint256 amountOutMin) external;
}

interface IRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata PATH,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IStableSwap {
    function exchange(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256 dy);
}

contract WUSDArb is Ownable {
    using SafeERC20 for IERC20;
    uint256 private constant MAXINT = type(uint256).max;
    IWUSDMaster private constant WUSDMASTER =
        IWUSDMaster(0x3D254b0efA0CdFf966e2A5600D3e6EB3450981b1);
    IRouter private constant WAULTROUTER =
        IRouter(0xD48745E39BbED146eEC15b79cBF964884F9877c2);
    IStableSwap private constant STABLESWAP =
        IStableSwap(0xb3F0C9ea1F05e312093Fdb031E789A756659B0AC);
    address[] private PATH = [
        address(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56),
        address(0x3fF997eAeA488A082fb7Efc8e6B9951990D0c3aB)
    ];
    IERC20 private constant BUSD =
        IERC20(0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56);
    IERC20 private constant WUSD =
        IERC20(0x3fF997eAeA488A082fb7Efc8e6B9951990D0c3aB);
    IERC20 private constant USDT =
        IERC20(0x55d398326f99059fF775485246999027B3197955);

    constructor() {
        BUSD.safeApprove(address(WAULTROUTER), MAXINT);
        WUSD.safeApprove(address(WUSDMASTER), MAXINT);
        USDT.safeApprove(address(STABLESWAP), MAXINT);
    }

    function swapAndRedeem(uint256 busdAmount, uint256 minAmountOut)
        external
        onlyOwner
    {
        BUSD.safeTransferFrom(address(msg.sender), address(this), busdAmount);
        _swapBusdToWusd(busdAmount, minAmountOut);
        _redeem(WUSD.balanceOf(address(this)));
    }

    function claimAndExchange(uint256 minUsdt, uint256 minBusd)
        external
        onlyOwner
    {
        _claim(minUsdt);
        _exchangeUsdtToBusd(USDT.balanceOf(address(this)), minBusd);
        BUSD.safeTransfer(address(msg.sender), BUSD.balanceOf(address(this)));
    }

    function swapBusdToWusd(uint256 busdAmount, uint256 minAmountOut)
        external
        onlyOwner
        returns (uint256[] memory)
    {
        return _swapBusdToWusd(busdAmount, minAmountOut);
    }

    function redeem(uint256 wusdAmount) external onlyOwner {
        _redeem(wusdAmount);
    }

    function claim(uint256 minUsdt) external onlyOwner {
        _claim(minUsdt);
    }

    function exchangeUsdtToBusd(uint256 minBusd)
        external
        onlyOwner
        returns (uint256)
    {
        return _exchangeUsdtToBusd(USDT.balanceOf(address(this)), minBusd);
    }

    function returnToken(address token, address destination)
        external
        onlyOwner
    {
        _transferToken(token, destination);
    }

    function _swapBusdToWusd(uint256 busdAmount, uint256 minAmountOut)
        private
        onlyOwner
        returns (uint256[] memory)
    {
        return
            WAULTROUTER.swapExactTokensForTokens(
                busdAmount,
                minAmountOut,
                PATH,
                address(this),
                block.timestamp
            );
    }

    function _redeem(uint256 wusdAmount) private onlyOwner {
        WUSDMASTER.redeem(wusdAmount);
    }

    function _claim(uint256 minUsdt) private onlyOwner {
        WUSDMASTER.claimUsdt(minUsdt);
    }

    function _exchangeUsdtToBusd(uint256 usdtAmount, uint256 minBusd)
        private
        onlyOwner
        returns (uint256)
    {
        return STABLESWAP.exchange(1, 0, usdtAmount, minBusd);
    }

    function _transferToken(address token, address destination)
        private
        onlyOwner
    {
        IERC20(token).safeTransfer(
            destination,
            IERC20(token).balanceOf(address(this))
        );
    }
}
