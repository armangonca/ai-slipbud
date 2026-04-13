// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRouter} from "./interfaces/IRouter.sol";
import {IPool, IFlashLoanSimpleReceiver} from "./interfaces/external/IFlashLoanSimpleReceiver.sol";
import {IUniswapV2Router, ISwapRouterV3} from "./interfaces/external/ISwapRouter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SlipBudRouter
/// @notice Arbitraj swap'larını ve flashloan'ları yöneten router kontratı.
///         V2 (Uniswap/SushiSwap) ve V3 (Uniswap V3) destekli.
///         Karı TREASURY'ye aktarır, sadece bot ve admin kullanabilir.
contract SlipBudRouter is IRouter, IFlashLoanSimpleReceiver, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---- Roles ---- //
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BOT_ROLE = keccak256("BOT_ROLE");

    // ---- State ---- //
    address public immutable TREASURY;
    address public immutable AAVE_POOL;

    /// @notice İzin verilen DEX router'ları (Uniswap V2, V3, SushiSwap vs.)
    mapping(address router => bool allowed) private _allowedRouters;
    /// @notice Her token için treasury'ye gönderilen toplam miktar
    mapping(address token => uint256 amount) private _totalSentToTreasury;

    // ---- Constructor ---- //
    constructor(
        address _treasury,
        address _aavePool,
        address _bot,
        address[] memory _initialRouters
    ) {
        if (_treasury == address(0) || _aavePool == address(0) || _bot == address(0)) {
            revert IRouter__ZeroAddress();
        }

        TREASURY = _treasury;
        AAVE_POOL = _aavePool;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(BOT_ROLE, _bot);

        for (uint256 i = 0; i < _initialRouters.length; i++) {
            _allowedRouters[_initialRouters[i]] = true;
            emit RouterUpdated(_initialRouters[i], true);
        }
    }

    // ---- Swap ---- //

    /// @inheritdoc IRouter
    function executeSwap(
        SwapParams calldata params
    ) external override onlyRole(BOT_ROLE) nonReentrant returns (uint256 amountOut) {
        if (params.amountIn == 0) revert IRouter__ZeroAmount();
        if (!_allowedRouters[params.router]) revert IRouter__RouterNotAllowed(params.router);

        amountOut = _executeSwapInternal(params);

        emit SwapExecuted(params.tokenIn, params.tokenOut, params.amountIn, amountOut, params.router);
    }

    /// @notice V2 veya V3 swap'ını çalıştıran internal fonksiyon
    function _executeSwapInternal(SwapParams memory params) internal returns (uint256 amountOut) {
        IERC20(params.tokenIn).safeIncreaseAllowance(params.router, params.amountIn);

        if (params.swapType == SwapType.V2) {
            amountOut = _swapV2(params);
        } else if (params.swapType == SwapType.V3) {
            amountOut = _swapV3(params);
        } else {
            revert IRouter__InvalidSwapType();
        }

        if (amountOut < params.amountOutMin) {
            revert IRouter__InsufficientOutput(params.amountOutMin, amountOut);
        }
    }

    /// @notice Uniswap V2 / SushiSwap swap
    function _swapV2(SwapParams memory params) internal returns (uint256 amountOut) {
        address[] memory path = abi.decode(params.path, (address[]));

        uint256[] memory amounts = IUniswapV2Router(params.router).swapExactTokensForTokens(
            params.amountIn,
            params.amountOutMin,
            path,
            address(this),
            params.deadline
        );

        amountOut = amounts[amounts.length - 1];
    }

    /// @notice Uniswap V3 swap — packed path kullanır (token + fee + token + ...)
    function _swapV3(SwapParams memory params) internal returns (uint256 amountOut) {
        amountOut = ISwapRouterV3(params.router).exactInput(
            ISwapRouterV3.ExactInputParams({
                path: params.path, // V3 packed path: abi.encodePacked(tokenA, fee, tokenB)
                recipient: address(this),
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMin
            })
        );
    }

    // ---- FlashLoan ---- //

    /// @inheritdoc IRouter
    function executeFlashLoan(
        FlashLoanParams calldata params
    ) external override onlyRole(BOT_ROLE) nonReentrant {
        if (params.amount == 0) revert IRouter__ZeroAmount();

        IPool(AAVE_POOL).flashLoanSimple(
            address(this),
            params.token,
            params.amount,
            params.swapData,
            0
        );
    }

    /// @notice Aave flashloan callback — swap zinciri çalıştır, borcu öde, karı treasury'ye gönder
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        if (msg.sender != AAVE_POOL) revert IRouter__FlashLoanFailed();
        if (initiator != address(this)) revert IRouter__FlashLoanFailed();

        // Swap zincirini çalıştır (V2 ve V3 karışık olabilir)
        SwapParams[] memory swaps = abi.decode(params, (SwapParams[]));

        for (uint256 i = 0; i < swaps.length; i++) {
            if (!_allowedRouters[swaps[i].router]) revert IRouter__RouterNotAllowed(swaps[i].router);
            _executeSwapInternal(swaps[i]);
        }

        // Borcu öde: ödünç + premium
        uint256 totalDebt = amount + premium;
        IERC20(asset).safeIncreaseAllowance(AAVE_POOL, totalDebt);

        // Kalan kar = bakiye - borç
        uint256 remaining = IERC20(asset).balanceOf(address(this));
        if (remaining <= totalDebt) revert IRouter__NoProfitMade();

        uint256 profit = remaining - totalDebt;

        // Karı treasury'ye gönder
        _totalSentToTreasury[asset] += profit;
        IERC20(asset).safeTransfer(TREASURY, profit);

        emit FlashLoanExecuted(asset, amount, profit);
        emit ProfitSentToTreasury(asset, profit);

        return true;
    }

    // ---- Admin ---- //

    /// @inheritdoc IRouter
    function setAllowedRouter(
        address router,
        bool allowed
    ) external override onlyRole(ADMIN_ROLE) {
        if (router == address(0)) revert IRouter__ZeroAddress();

        _allowedRouters[router] = allowed;

        emit RouterUpdated(router, allowed);
    }

    // ---- View ---- //

    /// @inheritdoc IRouter
    function isAllowedRouter(address router) external view override returns (bool) {
        return _allowedRouters[router];
    }

    /// @notice Kontrat üzerindeki token bakiyesini sorgula
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Belirli bir token için treasury'ye gönderilen toplam miktar
    function getTotalSentToTreasury(address token) external view returns (uint256) {
        return _totalSentToTreasury[token];
    }

    /// @notice Takılı kalan fonları treasury'ye gönder
    function sweepToTreasury(
        address token
    ) external onlyRole(ADMIN_ROLE) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert IRouter__ZeroAmount();

        _totalSentToTreasury[token] += balance;
        IERC20(token).safeTransfer(TREASURY, balance);

        emit ProfitSentToTreasury(token, balance);
    }
}
