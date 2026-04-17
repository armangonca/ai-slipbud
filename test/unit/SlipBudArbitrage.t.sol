// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseUnitTest} from "../BaseUnitTest.t.sol";
import {IRouter} from "contracts/interfaces/IRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Pull-based arbitraj akışının unit testi — mock V2/V3 ile kârlı senaryo
contract SlipBudArbitrageTest is BaseUnitTest {
    function test_executeArbitrage_profitable() public {
        // Setup: vault'a 10 WETH deposit, bot allowance 2 WETH
        _depositAsUser(admin, 10 ether);
        _setBotAllowance(weth, 2 ether);

        // V2'de WETH→USDC @ 1 WETH = 2000 USDC (rate 2000 * 10^6 / 1 * 10^18 = ... karmaşık)
        // Basit tutalım: aynı decimal varsayıp oran belirle (test için)
        // V2: 1 WETH = 1.00x USDC (yani %100)
        // V3: USDC→WETH, geri dönüşte %105 (kar çıkar)
        mockV2.setRate(weth, usdc, 10_000); // 1:1
        mockV3.setRate(usdc, weth, 10_500); // %5 kar

        // buySwap: WETH → USDC (V2)
        address[] memory buyPath = new address[](2);
        buyPath[0] = weth;
        buyPath[1] = usdc;

        IRouter.SwapParams memory buySwap = IRouter.SwapParams({
            router: uniV2Router,
            swapType: IRouter.SwapType.V2,
            tokenIn: weth,
            tokenOut: usdc,
            amountIn: 1 ether,
            amountOutMin: 0,
            path: abi.encode(buyPath),
            deadline: block.timestamp + 300
        });

        // sellSwap: USDC → WETH (V3)
        bytes memory sellPath = abi.encodePacked(usdc, uint24(3000), weth);

        IRouter.SwapParams memory sellSwap = IRouter.SwapParams({
            router: uniV3Router,
            swapType: IRouter.SwapType.V3,
            tokenIn: usdc,
            tokenOut: weth,
            amountIn: 0, // executeArbitrage override eder
            amountOutMin: 0,
            path: sellPath,
            deadline: block.timestamp + 300
        });

        IRouter.ArbitrageParams memory params =
            IRouter.ArbitrageParams({pullAmount: 1 ether, profitToken: weth, buySwap: buySwap, sellSwap: sellSwap});

        uint256 balanceBefore = IERC20(weth).balanceOf(address(treasury));

        vm.prank(bot);
        uint256 profit = router.executeArbitrage(params);

        uint256 balanceAfter = IERC20(weth).balanceOf(address(treasury));

        // 1 WETH → 1 USDC → 1.05 WETH = 0.05 WETH kar
        assertEq(profit, 0.05 ether, "profit mismatch");
        assertEq(balanceAfter, balanceBefore + 0.05 ether, "treasury balance");
    }
}
