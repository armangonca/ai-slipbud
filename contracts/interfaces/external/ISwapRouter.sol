// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Uniswap V2 Router — swap fonksiyonları
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

/// @notice Uniswap V3 SwapRouter — swap fonksiyonları
interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee; // fee tier: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%)
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96; // 0 = limit yok
    }

    struct ExactInputParams {
        bytes path; // multi-hop: abi.encodePacked(tokenA, fee, tokenB, fee, tokenC)
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /// @notice Tek hop swap (tokenA -> tokenB)
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    /// @notice Multi-hop swap (tokenA -> tokenB -> tokenC)
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
