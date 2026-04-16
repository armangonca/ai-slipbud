// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {SlipBudRouter} from "contracts/SlipBudRouter.sol";
import {SlipBudTreasury} from "contracts/SlipBudTreasury.sol";
import {SlipBudFactory} from "contracts/SlipBudFactory.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title BaseTest
/// @notice Unit ve fork testlerin ortak iskeleti. Türetilen sınıf `setUp` içinde
///         deploy ve token adreslerini doldurur, `_fund`'u override eder.
abstract contract BaseTest is Test {
    // ---- Deployed contracts ---- //
    SlipBudTreasury internal treasury;
    SlipBudRouter internal router;
    SlipBudFactory internal factory;

    // ---- Token addresses ---- //
    address internal weth;
    address internal usdc;
    address internal usdt;
    address internal dai;
    address internal wbtc;

    // ---- External protocol addresses ---- //
    address internal uniV2Router;
    address internal uniV3Router;
    address internal sushiRouter;
    address internal aavePool;

    // ---- Actors ---- //
    address internal admin = makeAddr("admin");
    address internal bot = makeAddr("bot");
    address internal user = makeAddr("user");
    address internal attacker = makeAddr("attacker");

    // ---- Abstract helpers ---- //

    /// @notice Türetilen test, kendi ortamına göre token fonlamasını yapar.
    ///         Unit: MockERC20.mint — Fork: deal cheatcode.
    function _fund(address token, address to, uint256 amount) internal virtual;

    // ---- Shared helpers ---- //

    /// @notice Kullanıcıya token basar ve vault'a deposit eder
    function _depositAsUser(address from, uint256 amount) internal {
        _fund(weth, from, amount);
        vm.startPrank(from);
        IERC20(weth).approve(address(treasury), amount);
        treasury.deposit(amount, from);
        vm.stopPrank();
    }

    /// @notice Bot'a token allowance ver (admin olarak çağır)
    function _setBotAllowance(address token, uint256 amount) internal {
        vm.prank(admin);
        treasury.setBotAllowance(token, amount);
    }
}
