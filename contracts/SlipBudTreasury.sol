// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ITreasury} from "./interfaces/ITreasury.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {
    ERC4626,
    ERC20,
    IERC20
} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title SlipBudTreasury
/// @notice Arbitraj botunun fonlarını saklayan ve yöneten vault kontratı.
///         ERC4626 tabanlı, AccessControl ile korunan kasa.
contract SlipBudTreasury is
    ITreasury,
    ERC4626,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    using SafeERC20 for IERC20;

    // ---- Roles ---- //
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BOT_ROLE = keccak256("BOT_ROLE");

    // ---- State ---- //
    /// @notice Her token için bot'un çekebileceği kalan miktar
    mapping(address token => uint256 allowance) private _botAllowance;
    /// @notice Her token için bot'un toplam çektiği miktar
    mapping(address token => uint256 amount) private _totalWithdrawn;
    /// @notice Her token için kasaya gelen toplam kar
    mapping(address token => uint256 amount) private _totalProfit;

    // ---- Constructor ---- //
    constructor(
        ConstructorData memory params
    ) ERC4626(params.asset) ERC20(params.vaultName, params.vaultSymbol) {
        if (params.bot == address(0)) revert ITreasury__ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(BOT_ROLE, params.bot);
    }

    // ---- Bot Fonksiyonları ---- //

    /// @inheritdoc ITreasury
    function withdrawForBot(
        address token,
        uint256 amount,
        address to
    ) external override onlyRole(BOT_ROLE) nonReentrant whenNotPaused {
        if (amount == 0) revert ITreasury__ZeroAmount();
        if (to == address(0)) revert ITreasury__ZeroAddress();

        uint256 currentAllowance = _botAllowance[token];
        if (amount > currentAllowance) {
            revert ITreasury__ExceedsBotAllowance(amount, currentAllowance);
        }

        _botAllowance[token] = currentAllowance - amount;
        _totalWithdrawn[token] += amount;
        IERC20(token).safeTransfer(to, amount);

        emit BotWithdraw(token, amount, to);
    }

    /// @inheritdoc ITreasury
    function depositProfit(
        address token,
        uint256 amount
    ) external override onlyRole(BOT_ROLE) nonReentrant whenNotPaused {
        if (amount == 0) revert ITreasury__ZeroAmount();

        _totalProfit[token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit ProfitDeposited(token, amount);
    }

    // ---- Admin Fonksiyonları ---- //

    /// @inheritdoc ITreasury
    function setBotAllowance(
        address token,
        uint256 amount
    ) external override onlyRole(ADMIN_ROLE) {
        _botAllowance[token] = amount;

        emit BotAllowanceSet(token, amount);
    }

    /// @inheritdoc ITreasury
    function emergencyWithdraw(
        address token,
        address to
    ) external override onlyRole(ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ITreasury__ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ITreasury__ZeroAmount();

        _botAllowance[token] = 0;
        _totalWithdrawn[token] += balance;

        IERC20(token).safeTransfer(to, balance);

        emit EmergencyWithdraw(token, balance);
    }

    /// @notice Kontratı durdur — tüm bot işlemleri durur
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @notice Kontratı tekrar aktif et
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ---- View Fonksiyonları ---- //

    /// @inheritdoc ITreasury
    function getBotAllowance(
        address token
    ) external view override returns (uint256) {
        return _botAllowance[token];
    }

    /// @notice Kasadaki herhangi bir tokenin bakiyesini sorgula
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Belirli bir token için toplam çekilen miktar
    function getTotalWithdrawn(address token) external view returns (uint256) {
        return _totalWithdrawn[token];
    }

    /// @notice Belirli bir token için toplam kar
    function getTotalProfit(address token) external view returns (uint256) {
        return _totalProfit[token];
    }

    /// @notice Net kar/zarar: toplam kar - toplam çekim
    function getNetPnL(address token) external view returns (int256) {
        return int256(_totalProfit[token]) - int256(_totalWithdrawn[token]);
    }

    // ---- Override (ERC4626 + AccessControl çakışması) ---- //

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
