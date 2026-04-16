// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseTest} from "./BaseTest.t.sol";
import {SlipBudFactory} from "contracts/SlipBudFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title BaseForkTest
/// @notice Mainnet fork ile integration test ortamı. Gerçek Uniswap, Aave, token'lar.
///         `MAINNET_RPC_URL` env değişkeni gerekli.
abstract contract BaseForkTest is BaseTest {
    // Mainnet adresleri
    address internal constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant MAINNET_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant MAINNET_USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address internal constant MAINNET_DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address internal constant MAINNET_WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;

    address internal constant MAINNET_UNI_V2 = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address internal constant MAINNET_UNI_V3 = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address internal constant MAINNET_SUSHI = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    address internal constant MAINNET_AAVE_V3 = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    function setUp() public virtual {
        // 1. Fork oluştur
        string memory rpc = vm.envString("MAINNET_RPC_URL");
        vm.createSelectFork(rpc);

        // 2. Adresleri doldur
        weth = MAINNET_WETH;
        usdc = MAINNET_USDC;
        usdt = MAINNET_USDT;
        dai = MAINNET_DAI;
        wbtc = MAINNET_WBTC;

        uniV2Router = MAINNET_UNI_V2;
        uniV3Router = MAINNET_UNI_V3;
        sushiRouter = MAINNET_SUSHI;
        aavePool = MAINNET_AAVE_V3;

        // 3. Factory üzerinden sistem deploy
        address[] memory routers = new address[](3);
        routers[0] = uniV2Router;
        routers[1] = uniV3Router;
        routers[2] = sushiRouter;

        address[] memory tokens = new address[](5);
        tokens[0] = weth;
        tokens[1] = usdc;
        tokens[2] = usdt;
        tokens[3] = dai;
        tokens[4] = wbtc;

        factory = new SlipBudFactory();

        vm.prank(admin);
        (treasury, router) = factory.deploy(
            SlipBudFactory.DeployParams({
                asset: IERC20(weth),
                vaultName: "SlipBud Vault",
                vaultSymbol: "sbVAULT",
                bot: bot,
                aavePool: aavePool,
                routers: routers,
                tokens: tokens
            })
        );
    }

    /// @dev Gerçek tokenlar için `deal` cheatcode'u kullan
    function _fund(address token, address to, uint256 amount) internal override {
        deal(token, to, amount);
    }
}
