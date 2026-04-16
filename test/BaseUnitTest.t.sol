// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseTest} from "./BaseTest.t.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockUniswapV2Router} from "./mocks/MockUniswapV2Router.sol";
import {MockUniswapV3Router} from "./mocks/MockUniswapV3Router.sol";
import {MockAavePool} from "./mocks/MockAavePool.sol";
import {SlipBudFactory} from "contracts/SlipBudFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title BaseUnitTest
/// @notice Mock'larla izole unit test ortamı. Rate ayarlanabilir V2/V3 router,
///         flashloan destekli Aave, mint edilebilir tokenlar.
abstract contract BaseUnitTest is BaseTest {
    MockUniswapV2Router internal mockV2;
    MockUniswapV3Router internal mockV3;
    MockAavePool internal mockAave;

    function setUp() public virtual {
        // 1. Tokenlar
        weth = address(new MockERC20("Wrapped Ether", "WETH", 18));
        usdc = address(new MockERC20("USD Coin", "USDC", 6));
        usdt = address(new MockERC20("Tether", "USDT", 6));
        dai = address(new MockERC20("Dai", "DAI", 18));
        wbtc = address(new MockERC20("Wrapped BTC", "WBTC", 8));

        // 2. Dış protokoller
        mockV2 = new MockUniswapV2Router();
        mockV3 = new MockUniswapV3Router();
        mockAave = new MockAavePool();

        uniV2Router = address(mockV2);
        uniV3Router = address(mockV3);
        aavePool = address(mockAave);

        // 3. Factory üzerinden sistem deploy
        address[] memory routers = new address[](2);
        routers[0] = uniV2Router;
        routers[1] = uniV3Router;

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

    /// @dev Mock tokenlar için mint kullan
    function _fund(address token, address to, uint256 amount) internal override {
        MockERC20(token).mint(amount, to);
    }

    /// @dev V2 ve V3 router'da rate ayarla (iki yöne de) — arbitraj simülasyonu için
    function _setRate(address tokenIn, address tokenOut, uint256 v2Rate, uint256 v3Rate) internal {
        mockV2.setRate(tokenIn, tokenOut, v2Rate);
        mockV2.setRate(tokenOut, tokenIn, v2Rate);
        mockV3.setRate(tokenIn, tokenOut, v3Rate);
        mockV3.setRate(tokenOut, tokenIn, v3Rate);
    }

    /// @dev Aave mock'un flashloan için token reserve'ini doldur
    function _fundAavePool(address token, uint256 amount) internal {
        _fund(token, aavePool, amount);
    }
}
