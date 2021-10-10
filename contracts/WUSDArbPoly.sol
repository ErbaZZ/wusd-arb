//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IWUSDMaster {
    function redeem(uint256 amount) external;

    function claimUsdc(uint256 amountOutMin) external;
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

contract WUSDArbPoly is Ownable {
    using SafeERC20 for IERC20;
    uint256 private constant MAXINT = type(uint256).max;
    IWUSDMaster private constant WUSDMASTER =
        IWUSDMaster(0xc9fF58Bd2A1CB4FAB0fEC5A0D061527Db1fbb923);
    IRouter private constant WAULTROUTER =
        IRouter(0x3a1D87f206D12415f5b0A33E786967680AAb4f6d);
    address[] private PATH = [
        address(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174),
        address(0xb8ab048D6744a276b2772dC81e406a4b769A5c3D)
    ];
    IERC20 private constant USDC =
        IERC20(0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174);
    IERC20 private constant WUSD =
        IERC20(0xb8ab048D6744a276b2772dC81e406a4b769A5c3D);

    constructor() {
        USDC.safeApprove(address(WAULTROUTER), MAXINT);
        WUSD.safeApprove(address(WUSDMASTER), MAXINT);
    }

    function swapAndRedeem(uint256 usdcAmount, uint256 minWusdAmount)
        external
        onlyOwner
    {
        USDC.safeTransferFrom(address(msg.sender), address(this), usdcAmount);
        _swapUsdcToWusd(usdcAmount, minWusdAmount);
        _redeem(WUSD.balanceOf(address(this)));
    }

    function claim(uint256 minUsdc) external onlyOwner {
        _claim(minUsdc);
        USDC.safeTransfer(address(msg.sender), USDC.balanceOf(address(this)));
    }

    function swapUsdcToWusd(uint256 usdcAmount, uint256 minWusdAmount)
        external
        onlyOwner
        returns (uint256[] memory)
    {
        return _swapUsdcToWusd(usdcAmount, minWusdAmount);
    }

    function redeem(uint256 wusdAmount) external onlyOwner {
        _redeem(wusdAmount);
    }

    function returnToken(address token, address destination)
        external
        onlyOwner
    {
        _transferToken(token, destination);
    }

    function _swapUsdcToWusd(uint256 usdcAmount, uint256 minWusdAmount)
        private
        returns (uint256[] memory)
    {
        return
            WAULTROUTER.swapExactTokensForTokens(
                usdcAmount,
                minWusdAmount,
                PATH,
                address(this),
                block.timestamp
            );
    }

    function _redeem(uint256 wusdAmount) private {
        WUSDMASTER.redeem(wusdAmount);
    }

    function _claim(uint256 minUsdc) private {
        WUSDMASTER.claimUsdc(minUsdc);
    }

    function _transferToken(address token, address destination) private {
        IERC20(token).safeTransfer(
            destination,
            IERC20(token).balanceOf(address(this))
        );
    }
}
