//SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "test/MockERC20.sol";
import {SlipBudRouter} from "contracts/SlipBudRouter.sol";
import {SlipBudTreasury} from "contracts/SlipBudTreasury.sol";
import {SlipBudFactory} from "contracts/SlipBudFactory.sol";
import {ITreasury} from "contracts/interfaces/ITreasury.sol";
import {IRouter} from "contracts/interfaces/IRouter.sol";
import {HelperConfig} from "script/HelperConfig.s.sol";
import {SlipBudDeployScript} from "script/SlipBudDeployScript.s.sol";

contract BaseTest is Test {
    SlipBudDeployScript public deployer;
    SlipBudRouter public router;
    SlipBudTreasury public treasury;
    SlipBudFactory public factory;
    HelperConfig public config;
    address public aaveV3Pool;
    address public uniswapV2Router;
    address public uniswapV3Router;
    address public sushiswapRouter;
    address public wethAddress;
    address public usdcAddress;
    address public usdtAddress;
    address public daiAddress;
    address public wbtcAddress;
    MockERC20 public weth;
    MockERC20 public usdc;
    MockERC20 public usdt;
    MockERC20 public dai;
    MockERC20 public wbtc;
    MockERC20 public awethTokenMock;
    MockERC20 public ausdcTokenMock;
    MockERC20 public ausdtTokenMock;
    MockERC20 public adaiTokenMock;
    MockERC20 public awbtcTokenMock;
    function setUp() public virtual {
        deployer = new SlipBudDeployScript();
        (treasury, router) = deployer.run();

        (
            aaveV3Pool,
            uniswapV2Router,
            uniswapV3Router,
            sushiswapRouter,
            wethAddress,
            usdcAddress,
            usdtAddress,
            daiAddress,
            wbtcAddress
        ) = config.activeConfig();

        weth = MockERC20(wethAddress);
        usdc = MockERC20(usdcAddress);
        usdt = MockERC20(usdtAddress);
        dai = MockERC20(daiAddress);
        wbtc = MockERC20(wbtcAddress);
    }
}
