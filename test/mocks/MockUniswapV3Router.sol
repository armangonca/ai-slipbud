// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISwapRouterV3} from "contracts/interfaces/external/ISwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Rate tabanlı V3 mock — setRate(tokenA, tokenB, bps) ile oranı ayarla.
///         Packed path'ten ilk ve son tokenı çözerek single-hop gibi davranır.
contract MockUniswapV3Router is ISwapRouterV3 {
    using SafeERC20 for IERC20;

    mapping(address tokenIn => mapping(address tokenOut => uint256 rateBps)) public rates;

    error MockV3__RateNotSet(address tokenIn, address tokenOut);
    error MockV3__InsufficientOutput(uint256 expected, uint256 actual);
    error MockV3__InvalidPath();

    function setRate(address tokenIn, address tokenOut, uint256 rateBps) external {
        rates[tokenIn][tokenOut] = rateBps;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        uint256 rate = rates[params.tokenIn][params.tokenOut];
        if (rate == 0) revert MockV3__RateNotSet(params.tokenIn, params.tokenOut);

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        amountOut = (params.amountIn * rate) / 10_000;
        if (amountOut < params.amountOutMinimum) {
            revert MockV3__InsufficientOutput(params.amountOutMinimum, amountOut);
        }

        MockERC20(params.tokenOut).mint(amountOut, params.recipient);
    }

    function exactInput(ExactInputParams calldata params) external payable override returns (uint256 amountOut) {
        // Path: tokenA (20) + fee (3) + tokenB (20) ... — min single hop 43 byte
        if (params.path.length < 43) revert MockV3__InvalidPath();

        address tokenIn = _extractAddress(params.path, 0);
        address tokenOut = _extractAddress(params.path, params.path.length - 20);

        uint256 rate = rates[tokenIn][tokenOut];
        if (rate == 0) revert MockV3__RateNotSet(tokenIn, tokenOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        amountOut = (params.amountIn * rate) / 10_000;
        if (amountOut < params.amountOutMinimum) {
            revert MockV3__InsufficientOutput(params.amountOutMinimum, amountOut);
        }

        MockERC20(tokenOut).mint(amountOut, params.recipient);
    }

    function _extractAddress(bytes memory data, uint256 offset) internal pure returns (address addr) {
        assembly {
            addr := shr(96, mload(add(add(data, 32), offset)))
        }
    }
}
