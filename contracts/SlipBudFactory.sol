// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SlipBudTreasury} from "./SlipBudTreasury.sol";
import {SlipBudRouter} from "./SlipBudRouter.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title SlipBudFactory
/// @notice Treasury + Router'ı tek TX'te deploy eder ve birbirine bağlar.
///         ROUTER_ROLE otomatik verilir — unutma riski sıfır.
contract SlipBudFactory {
    event SystemDeployed(address indexed treasury, address indexed router, address indexed bot);

    struct DeployParams {
        IERC20 asset; // vault'un ana tokeni (ör: WETH)
        string vaultName;
        string vaultSymbol;
        address bot; // agent/bot adresi
        address aavePool; // Aave V3 pool adresi
        address[] routers; // izinli DEX router'ları
        address[] tokens; // izinli tokenlar
    }

    /// @notice Tüm sistemi tek TX'te deploy et
    /// @return treasury Deploy edilen Treasury adresi
    /// @return router Deploy edilen Router adresi
    function deploy(DeployParams calldata params) external returns (SlipBudTreasury treasury, SlipBudRouter router) {
        // 1. Treasury deploy
        ITreasury.ConstructorData memory treasuryParams = ITreasury.ConstructorData({
            asset: params.asset, vaultName: params.vaultName, vaultSymbol: params.vaultSymbol, bot: params.bot
        });

        treasury = new SlipBudTreasury(treasuryParams);

        // 2. Router deploy (Treasury adresini biliyor artık)
        router = new SlipBudRouter(address(treasury), params.aavePool, params.bot, params.routers, params.tokens);

        // 3. ROUTER_ROLE otomatik ver — atomik, unutulamaz
        treasury.grantRole(treasury.ROUTER_ROLE(), address(router));

        // 4. Treasury admin'ini çağırana devret, factory'de kalmasın
        bytes32 adminRole = treasury.DEFAULT_ADMIN_ROLE();
        bytes32 treasuryAdminRole = treasury.ADMIN_ROLE();
        treasury.grantRole(adminRole, msg.sender);
        treasury.grantRole(treasuryAdminRole, msg.sender);
        treasury.renounceRole(adminRole, address(this));
        treasury.renounceRole(treasuryAdminRole, address(this));

        emit SystemDeployed(address(treasury), address(router), params.bot);
    }
}
