// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IUniswapV2Router} from "contracts/interfaces/external/ISwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Rate tabanlı V2 mock — setRate(tokenA, tokenB, bps) ile çıktı oranı ayarla.
///         10000 = 1:1, 10500 = %5 kar, 9500 = %5 zarar.
///         Çıktı tokenını mint ederek simüle eder (reserve yönetimi yok).
contract MockUniswapV2Router is IUniswapV2Router {
    using SafeERC20 for IERC20;

    mapping(address tokenIn => mapping(address tokenOut => uint256 rateBps)) public rates;

    error MockV2__RateNotSet(address tokenIn, address tokenOut);
    error MockV2__InsufficientOutput(uint256 expected, uint256 actual);

    function setRate(address tokenIn, address tokenOut, uint256 rateBps) external {
        rates[tokenIn][tokenOut] = rateBps;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external override returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);

        uint256 current = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            uint256 rate = rates[path[i]][path[i + 1]];
            if (rate == 0) revert MockV2__RateNotSet(path[i], path[i + 1]);
            current = (current * rate) / 10_000;
            amounts[i + 1] = current;
        }

        if (current < amountOutMin) revert MockV2__InsufficientOutput(amountOutMin, current);

        MockERC20(path[path.length - 1]).mint(current, to);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view override returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        uint256 current = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            uint256 rate = rates[path[i]][path[i + 1]];
            if (rate == 0) revert MockV2__RateNotSet(path[i], path[i + 1]);
            current = (current * rate) / 10_000;
            amounts[i + 1] = current;
        }
    }
}
