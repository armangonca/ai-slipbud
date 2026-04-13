// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRouter {
    // ---- Enums ---- //
    enum SwapType {
        V2, // Uniswap V2 / SushiSwap — address[] path
        V3 // Uniswap V3 — packed bytes path (token + fee + token)
    }

    // ---- Structs ---- //
    struct SwapParams {
        SwapType swapType;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin; // minimum kabul edilen çıktı (slippage koruması)
        address router; // hangi DEX router'ı kullanılacak
        bytes path; // V2: abi.encode(address[]) | V3: abi.encodePacked(token, fee, token, ...)
        uint256 deadline;
    }

    struct FlashLoanParams {
        address token; // ödünç alınacak token
        uint256 amount; // ödünç miktarı
        bytes swapData; // flashloan içinde çalıştırılacak swap datası
    }

    // ---- Events ---- //
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed dexRouter
    );
    event FlashLoanExecuted(
        address indexed token,
        uint256 amount,
        uint256 profit
    );
    event ProfitSentToTreasury(address indexed token, uint256 amount);
    event RouterUpdated(address indexed router, bool allowed);

    // ---- Errors ---- //
    error IRouter__SwapFailed();
    error IRouter__InsufficientOutput(uint256 expected, uint256 actual);
    error IRouter__RouterNotAllowed(address router);
    error IRouter__FlashLoanFailed();
    error IRouter__NoProfitMade();
    error IRouter__ZeroAmount();
    error IRouter__ZeroAddress();
    error IRouter__InvalidSwapType();

    // ---- Functions ---- //

    /// @notice DEX üzerinde swap yap (V2 veya V3)
    function executeSwap(
        SwapParams calldata params
    ) external returns (uint256 amountOut);

    /// @notice Aave flashloan başlat ve arbitraj yap
    function executeFlashLoan(FlashLoanParams calldata params) external;

    /// @notice İzin verilen DEX router ekle/kaldır
    function setAllowedRouter(address router, bool allowed) external;

    /// @notice Router'ın izinli olup olmadığını kontrol et
    function isAllowedRouter(address router) external view returns (bool);
}
