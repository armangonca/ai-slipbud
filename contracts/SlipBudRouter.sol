// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IRouter} from "./interfaces/IRouter.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {
    IPool,
    IFlashLoanSimpleReceiver
} from "./interfaces/external/IFlashLoanSimpleReceiver.sol";
import {
    IUniswapV2Router,
    ISwapRouterV3
} from "./interfaces/external/ISwapRouter.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title SlipBudRouter
/// @notice Arbitraj swap'larını ve flashloan'ları yöneten router kontratı.
///         Pull-based: Treasury'den fon çeker, trade yapar, tümünü geri gönderir.
///         V2 (Uniswap/SushiSwap) ve V3 (Uniswap V3) destekli.
contract SlipBudRouter is
    IRouter,
    IFlashLoanSimpleReceiver,
    AccessControl,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ---- Roles ---- //
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BOT_ROLE = keccak256("BOT_ROLE");

    // ---- State ---- //
    address public immutable TREASURY;
    address public immutable AAVE_POOL;

    /// @notice Tek flashloan'da izin verilen maksimum swap sayısı
    uint256 public constant MAX_SWAPS_PER_FLASHLOAN = 5;

    /// @notice İzin verilen DEX router'ları (Uniswap V2, V3, SushiSwap vs.)
    mapping(address router => bool allowed) private _allowedRouters;
    /// @notice Swap'larda kullanılmasına izin verilen tokenlar (WETH, USDC, vb.)
    mapping(address token => bool allowed) private _allowedTokens;
    /// @notice Her token için treasury'ye gönderilen toplam miktar
    mapping(address token => uint256 amount) private _totalSentToTreasury;

    // ---- Constructor ---- //
    constructor(
        address _treasury,
        address _aavePool,
        address _bot,
        address[] memory _initialRouters,
        address[] memory _initialTokens
    ) {
        if (
            _treasury == address(0) ||
            _aavePool == address(0) ||
            _bot == address(0)
        ) {
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

        for (uint256 i = 0; i < _initialTokens.length; i++) {
            _allowedTokens[_initialTokens[i]] = true;
            emit TokenUpdated(_initialTokens[i], true);
        }
    }

    // ---- Swap ---- //

    /// @inheritdoc IRouter
    function executeSwap(
        SwapParams calldata params
    )
        external
        override
        onlyRole(BOT_ROLE)
        nonReentrant
        returns (uint256 amountOut)
    {
        if (params.amountIn == 0) revert IRouter__ZeroAmount();
        if (!_allowedRouters[params.router])
            revert IRouter__RouterNotAllowed(params.router);

        amountOut = _executeSwapInternal(params);

        emit SwapExecuted(
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            params.router
        );
    }

    /// @notice V2 veya V3 swap'ını çalıştıran internal fonksiyon
    function _executeSwapInternal(
        SwapParams memory params
    ) internal returns (uint256 amountOut) {
        if (!_allowedTokens[params.tokenIn])
            revert IRouter__TokenNotAllowed(params.tokenIn);
        if (!_allowedTokens[params.tokenOut])
            revert IRouter__TokenNotAllowed(params.tokenOut);

        IERC20(params.tokenIn).forceApprove(params.router, params.amountIn);

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

        // Artık allowance kalmasın
        IERC20(params.tokenIn).forceApprove(params.router, 0);
    }

    /// @notice Uniswap V2 / SushiSwap swap
    function _swapV2(
        SwapParams memory params
    ) internal returns (uint256 amountOut) {
        address[] memory path = abi.decode(params.path, (address[]));

        uint256[] memory amounts = IUniswapV2Router(params.router)
            .swapExactTokensForTokens(
                params.amountIn,
                params.amountOutMin,
                path,
                address(this),
                params.deadline
            );

        amountOut = amounts[amounts.length - 1];
    }

    /// @notice Uniswap V3 swap — packed path kullanır (token + fee + token + ...)
    function _swapV3(
        SwapParams memory params
    ) internal returns (uint256 amountOut) {
        amountOut = ISwapRouterV3(params.router).exactInput(
            ISwapRouterV3.ExactInputParams({
                path: params.path, // V3 packed path: abi.encodePacked(tokenA, fee, tokenB)
                recipient: address(this),
                deadline: params.deadline,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMin
            })
        );
    }

    // ---- Atomik Arbitraj (Pull-Based) ---- //

    /// @inheritdoc IRouter
    function executeArbitrage(
        ArbitrageParams calldata params
    )
        external
        override
        onlyRole(BOT_ROLE)
        nonReentrant
        returns (uint256 profit)
    {
        if (params.pullAmount == 0) revert IRouter__ZeroAmount();
        if (params.buySwap.amountIn > params.pullAmount)
            revert IRouter__PullAmountTooLow();
        if (!_allowedRouters[params.buySwap.router])
            revert IRouter__RouterNotAllowed(params.buySwap.router);
        if (!_allowedRouters[params.sellSwap.router])
            revert IRouter__RouterNotAllowed(params.sellSwap.router);

        // 1. Treasury'den fon çek (pull-based)
        ITreasury(TREASURY).pullForBot(params.profitToken, params.pullAmount);

        // 2. Buy swap: tokenIn -> tokenOut
        uint256 buyOut = _executeSwapInternal(params.buySwap);

        // 3. Sell swap: tokenOut -> tokenIn (amountIn = buy çıktısı)
        SwapParams memory sellSwap = params.sellSwap;
        sellSwap.amountIn = buyOut;
        _executeSwapInternal(sellSwap);

        // 4. Sonucu hesapla
        uint256 totalBalance = IERC20(params.profitToken).balanceOf(
            address(this)
        );
        if (totalBalance <= params.pullAmount) revert IRouter__NoProfitMade();

        profit = totalBalance - params.pullAmount;

        // 5. HER ŞEYİ Treasury'ye geri gönder (çekilen miktar + kar)
        IERC20(params.profitToken).safeTransfer(TREASURY, totalBalance);
        _totalSentToTreasury[params.profitToken] += totalBalance;

        // 6. Treasury'de muhasebe kaydı
        ITreasury(TREASURY).recordProfit(
            params.profitToken,
            profit,
            totalBalance
        );

        emit ArbitrageExecuted(
            params.buySwap.tokenIn,
            params.buySwap.tokenOut,
            params.buySwap.amountIn,
            profit
        );
        emit ProfitSentToTreasury(params.profitToken, totalBalance);
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

        if (swaps.length == 0 || swaps.length > MAX_SWAPS_PER_FLASHLOAN) {
            revert IRouter__InvalidSwapCount();
        }

        for (uint256 i = 0; i < swaps.length; i++) {
            if (!_allowedRouters[swaps[i].router])
                revert IRouter__RouterNotAllowed(swaps[i].router);
            _executeSwapInternal(swaps[i]);
        }

        // Borcu öde: ödünç + premium
        uint256 totalDebt = amount + premium;
        IERC20(asset).forceApprove(AAVE_POOL, totalDebt);

        // Kalan kar = bakiye - borç
        uint256 remaining = IERC20(asset).balanceOf(address(this));
        if (remaining <= totalDebt) revert IRouter__NoProfitMade();

        uint256 flashProfit = remaining - totalDebt;

        // Karı treasury'ye gönder
        _totalSentToTreasury[asset] += flashProfit;
        IERC20(asset).safeTransfer(TREASURY, flashProfit);

        emit FlashLoanExecuted(asset, amount, flashProfit);
        emit ProfitSentToTreasury(asset, flashProfit);

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

    /// @notice Swap'larda kullanılabilecek token ekle/kaldır
    function setAllowedToken(
        address token,
        bool allowed
    ) external onlyRole(ADMIN_ROLE) {
        if (token == address(0)) revert IRouter__ZeroAddress();

        _allowedTokens[token] = allowed;

        emit TokenUpdated(token, allowed);
    }

    // ---- View ---- //

    /// @inheritdoc IRouter
    function isAllowedRouter(
        address router
    ) external view override returns (bool) {
        return _allowedRouters[router];
    }

    /// @notice Token'ın swap whitelist'inde olup olmadığını kontrol et
    function isAllowedToken(address token) external view returns (bool) {
        return _allowedTokens[token];
    }

    /// @notice Kontrat üzerindeki token bakiyesini sorgula
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Belirli bir token için treasury'ye gönderilen toplam miktar
    function getTotalSentToTreasury(
        address token
    ) external view returns (uint256) {
        return _totalSentToTreasury[token];
    }

    /// @notice Takılı kalan fonları treasury'ye gönder (bot ve admin çağırabilir)
    function sweepToTreasury(address token) external {
        if (
            !hasRole(BOT_ROLE, msg.sender) && !hasRole(ADMIN_ROLE, msg.sender)
        ) {
            revert IRouter__Unauthorized();
        }
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert IRouter__ZeroAmount();

        _totalSentToTreasury[token] += balance;
        IERC20(token).safeTransfer(TREASURY, balance);

        emit ProfitSentToTreasury(token, balance);
    }
}
