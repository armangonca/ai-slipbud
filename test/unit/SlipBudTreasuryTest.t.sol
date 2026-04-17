// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {BaseUnitTest} from "../BaseUnitTest.t.sol";
import {console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITreasury} from "contracts/interfaces/ITreasury.sol";

contract SlipBudTreasuryTest is BaseUnitTest {
    function setUp() public override {
        BaseUnitTest.setUp();
    }

    /*//////////////////////////////////////////////////////////////
                         ADMIN FUNCTIONS TESTS
    //////////////////////////////////////////////////////////////*/

    function testSetBotAllowance() public {
        console2.log("old allowance", treasury.getBotAllowance(wbtc));
        vm.prank(admin);
        treasury.setBotAllowance(wbtc, 1e5);
        treasury.getBotAllowance(wbtc);
        console2.log("new allowance", treasury.getBotAllowance(wbtc));
    }

    function testAdminWithdrawCanWithdraw() public {
        BaseUnitTest._fund(address(weth), address(treasury), 10e18);

        uint256 beforeWethBalance = IERC20(weth).balanceOf(address(treasury));
        console2.log("Tresury Balance :", beforeWethBalance / 1e18);

        uint256 beforeAdminBalance = IERC20(weth).balanceOf(address(admin));
        console2.log("Admin Balance :", beforeAdminBalance / 1e18);

        vm.prank(admin);
        treasury.adminWithdraw(weth, admin, 1e18);

        uint256 afterWithdrawBalance = IERC20(weth).balanceOf(
            address(treasury)
        );
        console2.log("Treasury Balance :", afterWithdrawBalance / 1e18);

        uint256 afterAdminBalance = IERC20(weth).balanceOf(address(admin));
        console2.log("Admin Balance :", afterAdminBalance / 1e18);

        assert(afterAdminBalance > beforeAdminBalance);
        assert(beforeWethBalance > afterWithdrawBalance);
    }

    function testEmergencyWithdrawCanWork() public {
        BaseUnitTest._fund(address(weth), address(treasury), 10e18);

        uint256 beforeWethBalance = IERC20(weth).balanceOf(address(treasury));
        console2.log("Tresury Balance :", beforeWethBalance / 1e18);

        uint256 beforeAdminBalance = IERC20(weth).balanceOf(address(admin));
        console2.log("Admin Balance :", beforeAdminBalance / 1e18);

        vm.prank(admin);
        treasury.emergencyWithdraw(weth, address(admin));

        uint256 afterWithdrawBalance = IERC20(weth).balanceOf(
            address(treasury)
        );
        console2.log("Treasury Balance :", afterWithdrawBalance / 1e18);

        uint256 afterAdminBalance = IERC20(weth).balanceOf(address(admin));
        console2.log("Admin Balance :", afterAdminBalance / 1e18);

        assertEq(afterAdminBalance, beforeWethBalance);
        assertEq(afterWithdrawBalance, 0);
    }

    function testTotalAssets() public {
        BaseUnitTest._fund(weth, address(treasury), 10e18);

        vm.startPrank(admin);
        treasury.setMaxBotDebt(10e18);
        treasury.setBotAllowance(weth, 5e18);
        vm.stopPrank();

        uint256 currentBotDebt = treasury.getBotDebt();
        assertEq(currentBotDebt, 0);

        vm.prank(address(router));
        treasury.pullForBot(weth, 3e18);

        uint256 totalAssets = treasury.totalAssets();
        assertEq(totalAssets, IERC20(weth).balanceOf(address(treasury)) + 3e18);
    }

    function testPause() public {
        vm.prank(admin);
        treasury.pause();

        assertTrue(treasury.paused());
    }

    function testUnpause() public {
        vm.startPrank(admin);
        treasury.pause();
        assertTrue(treasury.paused());

        treasury.unpause();
        assertFalse(treasury.paused());
        vm.stopPrank();
    }

    function testSetMaxBotDebt() public {
        vm.prank(admin);
        treasury.setMaxBotDebt(1e18);

        uint256 setMaxBotDebt = treasury.getMaxBotDebt();

        assertEq(setMaxBotDebt, 1e18);
    }

    /*//////////////////////////////////////////////////////////////
                              ROUTER TESTS
    //////////////////////////////////////////////////////////////*/

    function testPullForBot() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(admin);
        treasury.setMaxBotDebt(10e18);
        treasury.setBotAllowance(weth, 5e18);
        vm.stopPrank();

        vm.prank(address(router));
        treasury.pullForBot(weth, 5e18);

        assertEq(IERC20(weth).balanceOf(address(router)), 5e18);
        assertEq(treasury.getBotAllowance(weth), 0);
        assertEq(treasury.getBotDebt(), 5e18);
    }

    function testRecordProfit() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(admin);
        treasury.setMaxBotDebt(10e18);
        treasury.setBotAllowance(weth, 5e18);
        vm.stopPrank();

        vm.prank(address(router));
        treasury.recordProfit(weth, 5e18, 10e18);

        uint256 recoredProfit = treasury.getTotalProfit(weth);

        assertEq(recoredProfit, 5e18);
    }

    /*//////////////////////////////////////////////////////////////
                        PAUSE AND UNPAUSE TESTS
    //////////////////////////////////////////////////////////////*/

    function testCantWithdrawWhenPaused() public {
        _depositAsUser(admin, 10e18);

        vm.startPrank(admin);
        treasury.pause();

        vm.expectRevert();
        treasury.withdraw(1e18, admin, admin);
        vm.stopPrank();
    }

    function testCantDepositWhenPaused() public {
        vm.startPrank(admin);
        treasury.pause();

        vm.expectRevert();
        treasury.deposit(10e18, address(treasury));
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                          BUSINESS LOGIC TESTS
    //////////////////////////////////////////////////////////////*/
    function testAdminWithdraw_CapsBotAllowance() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(admin);
        treasury.setBotAllowance(weth, 100e18);
        treasury.adminWithdraw(weth, address(admin), 15e18);
        vm.stopPrank();

        uint256 allowance = treasury.getBotAllowance(weth);
        assertEq(allowance, 85e18);
    }

    function testRecordProfit_ReducesBotDebt() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        treasury.setBotAllowance(weth, 100e18);

        vm.startPrank(address(router));
        treasury.pullForBot(weth, 5e18);

        uint256 currentDebt = treasury.getBotDebt();
        console2.log("current debt:", currentDebt / 1e18);

        treasury.recordProfit(weth, 5e18, 10e18);
        vm.stopPrank();

        uint256 newDebt = treasury.getBotDebt();
        console2.log("new debt:", newDebt / 1e18);

        assert(currentDebt > newDebt);
        assertEq(newDebt, 0);
    }

    function testEmergencyWithdraw_ResetsBotDebt() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        treasury.setBotAllowance(weth, 100e18);

        vm.prank(address(router));
        treasury.pullForBot(weth, 10e18);

        uint256 currentBotDebt = treasury.getBotDebt();
        console2.log("current debt:", currentBotDebt / 1e18);

        vm.prank(admin);
        treasury.emergencyWithdraw(weth, admin);

        uint256 newBotDebt = treasury.getBotDebt();
        console2.log("new debt:", newBotDebt / 1e18);

        assertEq(newBotDebt, 0);
        assert(currentBotDebt > newBotDebt);
    }

    function testAdminWithdrawShoulNotResetBotDebt() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        treasury.setBotAllowance(weth, 100e18);

        vm.prank(address(router));
        treasury.pullForBot(weth, 10e18);

        uint256 currentBotDebt = treasury.getBotDebt();
        console2.log("current debt:", currentBotDebt / 1e18);

        uint256 balance = IERC20(weth).balanceOf(address(treasury));

        vm.prank(admin);
        treasury.adminWithdraw(weth, admin, balance);

        uint256 newBotDebt = treasury.getBotDebt();
        console2.log("new debt:", newBotDebt / 1e18);

        assertEq(newBotDebt, currentBotDebt);
    }

    function testDepositAndWithdraw_SharePrice() public {
        uint256 depositAmount = 10e18;

        _depositAsUser(admin, depositAmount);

        uint256 sharesReceived = treasury.balanceOf(admin);
        assertGt(sharesReceived, 0);

        uint256 priceBefore = treasury.convertToAssets(sharesReceived);
        assertEq(priceBefore, depositAmount);

        vm.startPrank(admin);
        IERC20(address(treasury)).approve(address(treasury), sharesReceived);
        uint256 assetsOut = treasury.redeem(sharesReceived, admin, admin);
        vm.stopPrank();

        // 4. Geri alınan miktar = yatırılan miktar (kayıp yok)
        assertEq(assetsOut, depositAmount);
        assertEq(treasury.balanceOf(admin), 0);
    }

    /*//////////////////////////////////////////////////////////////
                         ACCSESS CONTROL TESTS
    //////////////////////////////////////////////////////////////*/

    function testRevertSetBotAllowance_NotAdmin() public {
        vm.startPrank(user);
        vm.expectRevert();
        treasury.setBotAllowance(weth, 10e18);
        vm.stopPrank();
    }

    function testRevertAdminWithdraw_NotAdmin() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(user);
        vm.expectRevert();
        treasury.adminWithdraw(weth, user, 1e18);
        vm.stopPrank();
    }

    function testRevertPullForBot_NotRouter() public {
        vm.startPrank(user);
        vm.expectRevert();
        treasury.pullForBot(weth, 1e18);
        vm.stopPrank();
    }
    function testRevertRecordProfit_NotRouter() public {
        vm.startPrank(user);
        vm.expectRevert();
        treasury.recordProfit(weth, 1e18, 2e18);
        vm.stopPrank();
    }

    function testRevertPause_NotAdmin() public {
        vm.startPrank(user);
        vm.expectRevert();
        treasury.pause();
        vm.stopPrank();
    }

    function testRevertDeposit_NotAdmin() public {
        vm.startPrank(user);
        vm.expectRevert();
        treasury.deposit(1e18, address(treasury));
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                              REVERT TESTS
    //////////////////////////////////////////////////////////////*/

    function testRevertPullForBot_ExceedsAllowance() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        treasury.setBotAllowance(weth, 10e18);

        vm.prank(address(router));
        vm.expectRevert();
        treasury.pullForBot(weth, 11e18);
    }

    function testRevertPullForBot_ExceedsDebtCeiling() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(admin);
        treasury.setBotAllowance(weth, 20e18);
        treasury.setMaxBotDebt(10e18);
        vm.stopPrank();

        vm.startPrank(address(router));
        treasury.pullForBot(weth, 10e18);
        treasury.recordProfit(weth, 2e18, 4e18);

        vm.expectRevert(
            abi.encodeWithSelector(
                ITreasury.ITreasury__ExceedsDebtCeiling.selector,
                16e18,
                10e18
            )
        );
        treasury.pullForBot(weth, 10e18);
    }
    function testRevertPullForBot_ZeroAmount() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        treasury.setBotAllowance(weth, 100e18);

        vm.prank(address(router));
        vm.expectRevert();
        treasury.pullForBot(weth, 0);
    }

    function testRevertAdminWithdraw_ZeroAmount() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        vm.expectRevert();
        treasury.adminWithdraw(weth, address(user), 0);
    }

    function testRevertAdminWithdraw_ZeroAddress() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        vm.expectRevert();
        treasury.adminWithdraw(weth, address(0), 1e18);
    }

    function testRevertAdminWithdraw_InsufficientBalance() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);
        vm.prank(admin);
        vm.expectRevert();
        treasury.adminWithdraw(weth, admin, 110e18);
    }

    function testRevertEmergencyWithdraw_ZeroBalance() public {
        vm.prank(admin);
        vm.expectRevert();
        treasury.emergencyWithdraw(weth, admin);
    }

    function testRevertPullForBot_WhenPaused() public {
        BaseUnitTest._fund(weth, address(treasury), 100e18);

        vm.startPrank(admin);
        treasury.setBotAllowance(weth, 100e18);
        treasury.pause();
        vm.stopPrank();

        vm.prank(address(router));
        vm.expectRevert();
        treasury.pullForBot(weth, 10e18);
    }

    /*//////////////////////////////////////////////////////////////
                             GETTERS TESTS
    //////////////////////////////////////////////////////////////*/

    function testGetBotAllowance() public {
        vm.prank(admin);
        treasury.setBotAllowance(weth, 1);

        uint256 allowance = treasury.getBotAllowance(weth);
        assertEq(allowance, 1);
    }

    function testGetTokenBalance() public {
        BaseUnitTest._fund(weth, address(treasury), 1e18);

        uint256 tokenBalance = treasury.getTokenBalance(weth);
        assertEq(tokenBalance, 1e18);
    }

    function testGetTotalWithdrawn() public {
        BaseUnitTest._fund(weth, address(treasury), 10e18);

        vm.prank(admin);
        treasury.adminWithdraw(weth, admin, 1e18);

        uint256 totalWithdrawnAmount = treasury.getTotalWithdrawn(weth);

        assertEq(totalWithdrawnAmount, 1e18);
    }

    function testGetTotalProfit() public {
        vm.prank(address(router));
        treasury.recordProfit(weth, 1e18, 2e18);

        uint256 recordedProfit = treasury.getTotalProfit(weth);
        assertEq(recordedProfit, 1e18);
    }

    function testGetNetPnlMoreWithdraw() public {
        BaseUnitTest._fund(weth, address(treasury), 10e18);

        vm.prank(admin);
        treasury.adminWithdraw(weth, admin, 5e18);

        vm.prank(address(router));
        treasury.recordProfit(weth, 1e18, 2e18);

        int256 netPnl = treasury.getNetPnL(weth);

        assertEq(netPnl, -4e18);
    }

    function testGetNetPnlMoreProfit() public {
        BaseUnitTest._fund(weth, address(treasury), 10e18);

        vm.prank(admin);
        treasury.adminWithdraw(weth, admin, 1e18);

        vm.prank(address(router));
        treasury.recordProfit(weth, 5e18, 10e18);

        int256 netPnl = treasury.getNetPnL(weth);

        assertEq(netPnl, 4e18);
    }

    function testGetBotDebt() public {
        BaseUnitTest._fund(weth, address(treasury), 10e18);

        vm.startPrank(admin);
        treasury.setMaxBotDebt(10e18);
        treasury.setBotAllowance(weth, 5e18);
        vm.stopPrank();

        uint256 currentBotDebt = treasury.getBotDebt();
        assertEq(currentBotDebt, 0);

        vm.prank(address(router));
        treasury.pullForBot(weth, 3e18);

        uint256 newBotDebt = treasury.getBotDebt();

        assert(newBotDebt > currentBotDebt);
        assertEq(newBotDebt, 3e18);
    }

    function testGetMaxBodDebt() public {
        vm.prank(admin);
        treasury.setMaxBotDebt(5e18);
        uint256 maxBotDebt = treasury.getMaxBotDebt();

        assertEq(maxBotDebt, 5e18);
    }
}
