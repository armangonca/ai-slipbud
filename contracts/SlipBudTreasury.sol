// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ITreasury} from "./interfaces/ITreasury.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title SlipBudTreasury
/// @notice Arbitraj botunun fonlarını saklayan ve yöneten vault kontratı.
///         ERC4626 tabanlı, AccessControl ile korunan kasa.
///         Router pull-based mekanizmayla fon çeker, trade sonrası geri gönderir.
contract SlipBudTreasury is ITreasury, ERC4626, AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---- Roles ---- //
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant BOT_ROLE = keccak256("BOT_ROLE");
    bytes32 public constant ROUTER_ROLE = keccak256("ROUTER_ROLE");

    // ---- State ---- //
    /// @notice Her token için bot'un çekebileceği kalan miktar
    mapping(address token => uint256 allowance) private _botAllowance;
    /// @notice Her token için bot'un toplam çektiği miktar
    mapping(address token => uint256 amount) private _totalWithdrawn;
    /// @notice Her token için kasaya gelen toplam kar
    mapping(address token => uint256 amount) private _totalProfit;
    /// @notice Bot'un vault asset'i üzerindeki aktif borcu (ERC4626 share fiyatını korumak için)
    uint256 private _botDebt;
    /// @notice _botDebt için tavan — bot bunu aşacak şekilde çekim yapamaz
    uint256 private _maxBotDebt;

    // ---- Constructor ---- //
    constructor(ConstructorData memory params) ERC4626(params.asset) ERC20(params.vaultName, params.vaultSymbol) {
        if (params.bot == address(0)) revert ITreasury__ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(BOT_ROLE, params.bot);
        // ROUTER_ROLE: SlipBudFactory tarafından otomatik verilir (deploy atomik)
    }

    // ---- Router Fonksiyonları (Pull-Based) ---- //

    /// @inheritdoc ITreasury
    function pullForBot(address token, uint256 amount)
        external
        override
        nonReentrant
        onlyRole(ROUTER_ROLE)
        whenNotPaused
    {
        if (amount == 0) revert ITreasury__ZeroAmount();

        uint256 currentAllowance = _botAllowance[token];
        if (amount > currentAllowance) {
            revert ITreasury__ExceedsBotAllowance(amount, currentAllowance);
        }

        _botAllowance[token] = currentAllowance - amount;
        _totalWithdrawn[token] += amount;

        // Vault asset çekiliyorsa borcu takip et (share fiyatını korur)
        if (token == asset()) {
            uint256 newDebt = _botDebt + amount;
            if (_maxBotDebt > 0 && newDebt > _maxBotDebt) {
                revert ITreasury__ExceedsDebtCeiling(newDebt, _maxBotDebt);
            }
            _botDebt = newDebt;
        }

        IERC20(token).safeTransfer(msg.sender, amount);

        emit FundsPulled(token, amount, msg.sender);
    }

    /// @inheritdoc ITreasury
    function recordProfit(address token, uint256 profit, uint256 returned)
        external
        override
        onlyRole(ROUTER_ROLE)
        whenNotPaused
    {
        _totalProfit[token] += profit;

        // Vault asset geri dönüyorsa borcu azalt
        if (token == asset()) {
            _botDebt = returned >= _botDebt ? 0 : _botDebt - returned;
        }

        emit ProfitRecorded(token, profit, returned);
    }

    // ---- Admin Fonksiyonları ---- //

    /// @inheritdoc ITreasury
    function setBotAllowance(address token, uint256 amount) external override onlyRole(ADMIN_ROLE) {
        _botAllowance[token] = amount;

        emit BotAllowanceSet(token, amount);
    }

    function adminWithdraw(address token, address to, uint256 amount) external nonReentrant onlyRole(ADMIN_ROLE) {
        if (to == address(0)) revert ITreasury__ZeroAddress();
        if (amount == 0) revert ITreasury__ZeroAmount();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) revert ITreasury__NotEnoughBalance();

        _totalWithdrawn[token] += amount;

        // Bot allowance bakiyeden fazlaysa yeni bakiyeye indir
        uint256 remaining = balance - amount;
        if (_botAllowance[token] > remaining) {
            _botAllowance[token] = remaining;
        }

        IERC20(token).safeTransfer(to, amount);
        emit AdminWithdraw(token, to, amount);
    }

    /// @notice Bot borç tavanını ayarla (0 = limit yok)
    function setMaxBotDebt(uint256 amount) external onlyRole(ADMIN_ROLE) {
        emit MaxBotDebtSet(_maxBotDebt, amount);
        _maxBotDebt = amount;
    }

    /// @inheritdoc ITreasury
    function emergencyWithdraw(address token, address to) external override nonReentrant onlyRole(ADMIN_ROLE) {
        if (to == address(0)) revert ITreasury__ZeroAddress();

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ITreasury__ZeroAmount();

        _botAllowance[token] = 0;
        _totalWithdrawn[token] += balance;

        // Vault asset acil çekiliyorsa borcu sıfırla
        if (token == asset()) {
            _botDebt = 0;
        }

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

    // ---- ERC4626 Override ---- //

    /// @notice Inflation attack koruması — sanal offset ile rounding manipülasyonunu engeller.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @notice Bot'un aktif borcu dahil toplam varlık — share fiyatını korur.
    function totalAssets() public view override(ERC4626, IERC4626) returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + _botDebt;
    }

    /// @notice Sadece admin deposit yapabilir, pause aktifken engellenir
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        onlyRole(ADMIN_ROLE)
    {
        super._deposit(caller, receiver, assets, shares);
    }

    /// @notice Sadece admin withdraw yapabilir, pause aktifken engellenir
    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        onlyRole(ADMIN_ROLE)
    {
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ---- View Fonksiyonları ---- //

    /// @inheritdoc ITreasury
    function getBotAllowance(address token) external view override returns (uint256) {
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

    /// @notice Bot'un vault asset üzerindeki aktif borcu
    function getBotDebt() external view returns (uint256) {
        return _botDebt;
    }

    /// @notice Bot borç tavanını görüntüle
    function getMaxBotDebt() external view returns (uint256) {
        return _maxBotDebt;
    }

    // ---- Override (ERC4626 + AccessControl çakışması) ---- //

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
