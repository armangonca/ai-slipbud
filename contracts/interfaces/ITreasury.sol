// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITreasury is IERC4626 {
    // ---- Structs ---- //
    struct ConstructorData {
        IERC20 asset; // vault'un ana tokeni (ör: WETH)
        string vaultName;
        string vaultSymbol;
        address bot; // agent/bot adresi
    }

    // ---- Events ---- //
    event BotWithdraw(
        address indexed token,
        uint256 amount,
        address indexed to
    );
    event ProfitDeposited(address indexed token, uint256 amount);
    event BotAllowanceSet(address indexed token, uint256 amount);
    event EmergencyWithdraw(address indexed token, uint256 amount);

    // ---- Errors ---- //
    error ITreasury__ExceedsBotAllowance(uint256 requested, uint256 available);
    error ITreasury__ZeroAmount();
    error ITreasury__ZeroAddress();

    // ---- Functions ---- //

    /// @notice Bot'un trade için fon çekmesi (allowance limiti dahilinde)
    function withdrawForBot(address token, uint256 amount, address to) external;

    /// @notice Router'dan gelen karı kasaya yatırma
    function depositProfit(address token, uint256 amount) external;

    /// @notice Bot'un belirli bir token için çekebileceği max limiti ayarla
    function setBotAllowance(address token, uint256 amount) external;

    /// @notice Bot'un kalan allowance'ını görüntüle
    function getBotAllowance(address token) external view returns (uint256);

    /// @notice Acil durumda admin tüm fonları çeker
    function emergencyWithdraw(address token, address to) external;
}
